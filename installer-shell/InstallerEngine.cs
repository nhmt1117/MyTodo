using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

namespace MyTodo.InstallerShell;

internal enum InstallerMode
{
    Fresh,
    Upgrade,
    Same,
    Downgrade,
    InAppUpdate,
}

internal sealed record InstallerSnapshot(
    InstallerMode Mode,
    string Version,
    string InstalledVersion,
    string InstallDirectory,
    bool AutoStartEnabled);

internal sealed record InstallProgress(int Percent, string Status);

internal sealed class InstallerEngine : IDisposable
{
    private const string ProductRegistryKey = @"Software\34df7b66-98d9-5bda-a4ff-830b6f4555d4";
    private const string UninstallRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\34df7b66-98d9-5bda-a4ff-830b6f4555d4";
    private const string AutoStartRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ProductName = "MyTodo";
    private const string PublisherName = "nhmt";
    private const string ProductDescription = "MyTodo 个人待办与循环提醒工具";
    private const string UninstallerFileName = "Uninstall MyTodo.exe";
    private const long EstimatedInstallBytes = 371L * 1024 * 1024;

    private readonly string _workingDirectory = Path.Combine(
        Path.GetTempPath(),
        "MyTodo-Installer",
        $"{Environment.ProcessId}-{Guid.NewGuid():N}");
    private string? _lockPath;
    private string? _backendPath;

    public InstallerEngine(bool inAppUpdate)
    {
        var installedVersion = ReadRegistryValue(UninstallRegistryKey, "DisplayVersion");
        var installDirectory = ReadRegistryValue(UninstallRegistryKey, "InstallLocation");
        if (string.IsNullOrWhiteSpace(installDirectory))
        {
            installDirectory = ReadRegistryValue(ProductRegistryKey, "InstallLocation");
        }

        installDirectory = string.IsNullOrWhiteSpace(installDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", ProductName)
            : installDirectory;

        var version = GetProductVersion();
        var mode = inAppUpdate
            ? InstallerMode.InAppUpdate
            : CompareVersions(installedVersion, version);

        Snapshot = new InstallerSnapshot(
            mode,
            version,
            installedVersion,
            installDirectory,
            IsAutoStartEnabled());
    }

    public InstallerSnapshot Snapshot { get; private set; }

    public static string EnsureMyTodoDirectory(string directory)
    {
        var fullPath = Path.GetFullPath(directory.Trim());
        return string.Equals(Path.GetFileName(fullPath.TrimEnd(Path.DirectorySeparatorChar)), ProductName, StringComparison.OrdinalIgnoreCase)
            ? fullPath.TrimEnd(Path.DirectorySeparatorChar)
            : Path.Combine(fullPath, ProductName);
    }

    public static string GetRequiredSpace() => FormatBytes(EstimatedInstallBytes);

    public static string GetAvailableSpace(string directory)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(directory));
            return string.IsNullOrWhiteSpace(root)
                ? "无法读取"
                : FormatBytes(new DriveInfo(root).AvailableFreeSpace);
        }
        catch
        {
            return "无法读取";
        }
    }

    public static bool IsMyTodoRunning()
    {
        try
        {
            return Process.GetProcessesByName(ProductName).Any(process =>
            {
                using (process)
                {
                    return !process.HasExited;
                }
            });
        }
        catch
        {
            return true;
        }
    }

    public void UpdateInstallDirectory(string directory)
    {
        Snapshot = Snapshot with { InstallDirectory = EnsureMyTodoDirectory(directory) };
    }

    public async Task InstallAsync(IProgress<InstallProgress> progress, CancellationToken cancellationToken)
    {
        if (IsMyTodoRunning())
        {
            throw new InvalidOperationException("MYTODO_RUNNING");
        }

        CreateInstallLock();
        using var launchGuardCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var launchGuard = PreventMyTodoLaunchesAsync(launchGuardCancellation.Token);
        try
        {
            progress.Report(new InstallProgress(4, Snapshot.Mode == InstallerMode.InAppUpdate ? "准备更新" : "准备安装"));

            _backendPath = await PayloadArchive.ExtractAsync(_workingDirectory, cancellationToken);
            progress.Report(new InstallProgress(12, Snapshot.Mode == InstallerMode.InAppUpdate ? "准备替换程序文件" : "准备写入程序文件"));

            var startInfo = new ProcessStartInfo
            {
                FileName = _backendPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = _workingDirectory,
            };
            startInfo.ArgumentList.Add("/S");
            if (Snapshot.Mode == InstallerMode.InAppUpdate)
            {
                startInfo.ArgumentList.Add("--updated");
            }
            startInfo.ArgumentList.Add($"/D={Snapshot.InstallDirectory}");

            using var backend = Process.Start(startInfo)
                ?? throw new InvalidOperationException("无法启动安装后端。");

            var percent = 12;
            while (!backend.HasExited)
            {
                await Task.Delay(160, cancellationToken);
                percent = Math.Min(88, percent + (percent < 48 ? 2 : 1));
                progress.Report(new InstallProgress(
                    percent,
                    Snapshot.Mode == InstallerMode.InAppUpdate ? "替换程序文件" : "写入程序文件"));
            }

            if (backend.ExitCode != 0)
            {
                throw new InvalidOperationException($"安装后端返回错误代码 {backend.ExitCode}。");
            }

            progress.Report(new InstallProgress(96, "验证安装结果"));
            await WaitForInstalledVersionAsync(cancellationToken);
            EnsureUninstallRegistration();
            NotifyWindowsShell();
            progress.Report(new InstallProgress(100, Snapshot.Mode == InstallerMode.InAppUpdate ? "更新完成" : "安装完成"));
            ReleaseInstallLock();
        }
        finally
        {
            launchGuardCancellation.Cancel();
            try
            {
                await launchGuard;
            }
            catch (OperationCanceledException)
            {
                // Expected when installation finishes or is cancelled.
            }
        }
    }

    public void ApplyFinishOptions(bool autoStart, bool launch)
    {
        var executable = Path.Combine(Snapshot.InstallDirectory, "MyTodo.exe");
        using (var runKey = Registry.CurrentUser.CreateSubKey(AutoStartRegistryKey))
        {
            if (autoStart)
            {
                runKey?.SetValue(ProductName, $"\"{executable}\" --hidden", RegistryValueKind.String);
            }
            else
            {
                runKey?.DeleteValue(ProductName, false);
            }
        }

        var optionsPath = Path.Combine(Snapshot.InstallDirectory, "resources", "mytodo-install-options.json");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(optionsPath)!);
            File.WriteAllText(optionsPath, JsonSerializer.Serialize(new { autoStart }));
        }
        catch
        {
            // The registry value is authoritative; the options file is a startup hint.
        }

        if (launch && File.Exists(executable))
        {
            var startInfo = new ProcessStartInfo(executable)
            {
                UseShellExecute = true,
                WorkingDirectory = Snapshot.InstallDirectory,
                Arguments = Snapshot.Mode == InstallerMode.InAppUpdate ? "--updated" : string.Empty,
            };
            Process.Start(startInfo);
        }
    }

    public void Dispose()
    {
        ReleaseInstallLock();
        try
        {
            if (Directory.Exists(_workingDirectory))
            {
                Directory.Delete(_workingDirectory, true);
            }
        }
        catch
        {
            // The OS will clear the temporary payload later if a scanner still holds it.
        }
    }

    private static InstallerMode CompareVersions(string installedVersion, string targetVersion)
    {
        if (string.IsNullOrWhiteSpace(installedVersion))
        {
            return InstallerMode.Fresh;
        }

        if (!Version.TryParse(installedVersion, out var installed)
            || !Version.TryParse(targetVersion, out var target))
        {
            return string.Equals(installedVersion, targetVersion, StringComparison.OrdinalIgnoreCase)
                ? InstallerMode.Same
                : InstallerMode.Upgrade;
        }

        return installed.CompareTo(target) switch
        {
            0 => InstallerMode.Same,
            > 0 => InstallerMode.Downgrade,
            _ => InstallerMode.Upgrade,
        };
    }

    private static string GetProductVersion()
    {
        var informational = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        return string.IsNullOrWhiteSpace(informational)
            ? "0.0.0"
            : informational.Split('+')[0];
    }

    private static string ReadRegistryValue(string keyPath, string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(keyPath);
        return key?.GetValue(name)?.ToString()?.Trim() ?? string.Empty;
    }

    private void EnsureUninstallRegistration()
    {
        var executable = Path.Combine(Snapshot.InstallDirectory, "MyTodo.exe");
        var uninstaller = Path.Combine(Snapshot.InstallDirectory, UninstallerFileName);
        if (!File.Exists(executable) || !File.Exists(uninstaller))
        {
            throw new InvalidOperationException("安装完成，但 Windows 卸载信息所需的程序文件不完整。");
        }

        using var key = Registry.CurrentUser.CreateSubKey(UninstallRegistryKey, writable: true)
            ?? throw new InvalidOperationException("无法向 Windows 注册 MyTodo 卸载信息。");
        key.SetValue("DisplayName", ProductName, RegistryValueKind.String);
        key.SetValue("DisplayVersion", Snapshot.Version, RegistryValueKind.String);
        key.SetValue("Publisher", PublisherName, RegistryValueKind.String);
        key.SetValue("Comments", ProductDescription, RegistryValueKind.String);
        key.SetValue("InstallLocation", Snapshot.InstallDirectory, RegistryValueKind.String);
        key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"), RegistryValueKind.String);
        key.SetValue("DisplayIcon", $"{executable},0", RegistryValueKind.String);
        key.SetValue("UninstallString", $"\"{uninstaller}\" /currentuser", RegistryValueKind.String);
        key.SetValue("QuietUninstallString", $"\"{uninstaller}\" /currentuser /S", RegistryValueKind.String);
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        key.DeleteValue("SystemComponent", false);
    }

    private static void NotifyWindowsShell()
    {
        NativeMethods.SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
        NativeMethods.SendMessageTimeout(
            new IntPtr(0xffff),
            0x001A,
            UIntPtr.Zero,
            @"Software\Microsoft\Windows\CurrentVersion\Uninstall",
            0x0002,
            5000,
            out _);
    }

    private static bool IsAutoStartEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(AutoStartRegistryKey);
        return key?.GetValue(ProductName) is not null;
    }

    private static class NativeMethods
    {
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(long eventId, uint flags, IntPtr item1, IntPtr item2);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(
            IntPtr window,
            uint message,
            UIntPtr wParam,
            string lParam,
            uint flags,
            uint timeout,
            out UIntPtr result);
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1024L * 1024 * 1024)
        {
            return $"{bytes / (1024d * 1024 * 1024):0.#} GB";
        }
        return $"{Math.Ceiling(bytes / (1024d * 1024)):0} MB";
    }

    private void CreateInstallLock()
    {
        _lockPath = Path.Combine(Path.GetTempPath(), $"MyTodo-installing-{Environment.ProcessId}.lock");
        File.WriteAllText(_lockPath, Environment.ProcessId.ToString());
    }

    private void ReleaseInstallLock()
    {
        if (string.IsNullOrWhiteSpace(_lockPath))
        {
            return;
        }

        try
        {
            File.Delete(_lockPath);
        }
        catch
        {
            // A stale lock is removed by MyTodo once this process has exited.
        }
        _lockPath = null;
    }

    private async Task WaitForInstalledVersionAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 20; attempt += 1)
        {
            var installedVersion = ReadRegistryValue(UninstallRegistryKey, "DisplayVersion");
            var executable = Path.Combine(Snapshot.InstallDirectory, "MyTodo.exe");
            if (string.Equals(installedVersion, Snapshot.Version, StringComparison.OrdinalIgnoreCase)
                && File.Exists(executable))
            {
                return;
            }

            await Task.Delay(100, cancellationToken);
        }

        throw new InvalidOperationException("安装结果验证失败，请重新运行安装程序。");
    }

    private static async Task PreventMyTodoLaunchesAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            foreach (var process in Process.GetProcessesByName(ProductName))
            {
                using (process)
                {
                    try
                    {
                        if (!process.HasExited)
                        {
                            process.Kill(entireProcessTree: true);
                        }
                    }
                    catch (InvalidOperationException)
                    {
                        // The process exited between enumeration and termination.
                    }
                    catch (System.ComponentModel.Win32Exception)
                    {
                        // The backend reports a running-app error if access is denied.
                    }
                }
            }

            await Task.Delay(40, cancellationToken);
        }
    }
}
