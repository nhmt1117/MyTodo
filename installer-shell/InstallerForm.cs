using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MyTodo.InstallerShell;

internal sealed class InstallerForm : Form
{
    private const int NormalWidth = 580;
    private const int NormalHeight = 360;
    private const int CompactWidth = 520;
    private const int CompactHeight = 230;

    private readonly InstallerEngine _engine;
    private readonly WebView2 _webView;
    private readonly bool _inAppUpdate;
    private bool _pageReady;
    private bool _allowClose;
    private bool _installing;
    private string _screen = "loading";

    public InstallerForm(string[] args)
    {
        _inAppUpdate = args.Any(arg => string.Equals(arg, "--updated", StringComparison.OrdinalIgnoreCase));
        _engine = new InstallerEngine(_inAppUpdate);

        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.White;
        FormBorderStyle = FormBorderStyle.None;
        MaximizeBox = false;
        MinimizeBox = false;
        Opacity = 0d;
        ShowIcon = true;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.CenterScreen;
        Text = _inAppUpdate ? "MyTodo 更新" : "MyTodo 安装";
        ClientSize = _inAppUpdate
            ? new Size(CompactWidth, CompactHeight)
            : new Size(NormalWidth, NormalHeight);
        MinimumSize = Size;
        MaximumSize = Size;
        Icon = LoadIcon();

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.White,
            TabStop = false,
        };
        Controls.Add(_webView);

        Shown += async (_, _) => await InitializeWebViewAsync();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            parameters.ClassStyle |= 0x00020000;
            return parameters;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var cornerPreference = 2;
        NativeMethods.DwmSetWindowAttribute(Handle, 33, ref cornerPreference, sizeof(int));
        var borderColor = 0x00D4D8DE;
        NativeMethods.DwmSetWindowAttribute(Handle, 34, ref borderColor, sizeof(int));
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
            if (!_installing && _screen == "welcome")
            {
                _ = ExecuteScriptAsync("window.installShell.showCancelConfirm();");
            }
            return;
        }

        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            try
            {
                _webView.CoreWebView2?.Stop();
            }
            catch
            {
                // The WebView may already be shutting down.
            }
            _webView.Dispose();
            _engine.Dispose();
            Icon?.Dispose();
        }
        base.Dispose(disposing);
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var userDataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MyTodo",
                "InstallerWebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataDirectory);
            await _webView.EnsureCoreWebView2Async(environment);

            var settings = _webView.CoreWebView2.Settings;
            settings.AreDefaultContextMenusEnabled = false;
            settings.AreDevToolsEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.IsZoomControlEnabled = false;
            settings.IsBuiltInErrorPageEnabled = false;
            _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
            _webView.CoreWebView2.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
            _webView.NavigateToString(LoadHtml());
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(
                "安装 MyTodo 需要 Microsoft Edge WebView2 Runtime，请先安装后再重试。",
                Text,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            _allowClose = true;
            Close();
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"无法打开安装界面。\n\n{error.Message}",
                Text,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            _allowClose = true;
            Close();
        }
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
    {
        if (!eventArgs.IsSuccess || _pageReady)
        {
            return;
        }

        _pageReady = true;
        if (_inAppUpdate)
        {
            await BeginInstallAsync();
            return;
        }

        _screen = _engine.Snapshot.Mode switch
        {
            InstallerMode.Fresh => "welcome",
            InstallerMode.Upgrade => "upgrade",
            InstallerMode.Same => "same",
            InstallerMode.Downgrade => "downgrade",
            _ => "welcome",
        };
        await RenderAsync();
        RevealInstaller();
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        try
        {
            using var message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            var root = message.RootElement;
            var action = root.TryGetProperty("action", out var actionElement)
                ? actionElement.GetString()
                : string.Empty;

            switch (action)
            {
                case "start":
                    _screen = "directory";
                    await RenderAsync();
                    break;
                case "back":
                    _screen = "welcome";
                    await RenderAsync();
                    break;
                case "browse":
                    BrowseForInstallDirectory();
                    await RenderAsync();
                    break;
                case "install":
                case "upgrade":
                    await BeginInstallAsync();
                    break;
                case "cancel-confirmed":
                case "cancel-upgrade":
                case "close":
                case "exit-running":
                    _allowClose = true;
                    Close();
                    break;
                case "finish":
                    var launch = !root.TryGetProperty("launch", out var launchElement) || launchElement.GetBoolean();
                    var autoStart = root.TryGetProperty("autoStart", out var autoStartElement) && autoStartElement.GetBoolean();
                    _engine.ApplyFinishOptions(autoStart, launch);
                    _allowClose = true;
                    Close();
                    break;
                case "finish-update":
                    _engine.ApplyFinishOptions(_engine.Snapshot.AutoStartEnabled, true);
                    _allowClose = true;
                    Close();
                    break;
                case "drag":
                    NativeMethods.ReleaseCapture();
                    NativeMethods.SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
                    break;
            }
        }
        catch (Exception error)
        {
            await ShowErrorAsync(error.Message);
        }
    }

    private void BrowseForInstallDirectory()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择 MyTodo 安装位置",
            InitialDirectory = Directory.Exists(_engine.Snapshot.InstallDirectory)
                ? _engine.Snapshot.InstallDirectory
                : Path.GetDirectoryName(_engine.Snapshot.InstallDirectory)
                    ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            ShowNewFolderButton = true,
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _engine.UpdateInstallDirectory(dialog.SelectedPath);
        }
    }

    private async Task BeginInstallAsync()
    {
        if (_installing)
        {
            return;
        }

        if (_inAppUpdate)
        {
            for (var attempt = 0; attempt < 24 && InstallerEngine.IsMyTodoRunning(); attempt += 1)
            {
                await Task.Delay(250);
            }
        }

        if (InstallerEngine.IsMyTodoRunning())
        {
            _screen = "running";
            await RenderAsync();
            RevealInstaller();
            return;
        }

        _installing = true;
        _screen = _inAppUpdate ? "update-progress" : "progress";
        await RenderAsync(new { progress = 2, status = _inAppUpdate ? "准备更新" : "准备安装" });
        RevealInstaller();
        await Task.Delay(180);

        var progress = new Progress<InstallProgress>(value =>
        {
            _ = RenderAsync(new { progress = value.Percent, status = value.Status });
        });

        try
        {
            await _engine.InstallAsync(progress, CancellationToken.None);
            await Task.Delay(240);
            _installing = false;
            _screen = _inAppUpdate ? "update-finish" : "finish";
            await RenderAsync();
        }
        catch (InvalidOperationException error) when (error.Message == "MYTODO_RUNNING")
        {
            _installing = false;
            _screen = "running";
            await RenderAsync();
        }
        catch (Exception error)
        {
            _installing = false;
            await ShowErrorAsync(error.Message);
        }
    }

    private async Task ShowErrorAsync(string message)
    {
        _screen = "error";
        await RenderAsync(new { message });
        RevealInstaller();
    }

    private void RevealInstaller()
    {
        if (Opacity >= 1d)
        {
            return;
        }

        Opacity = 1d;
        Activate();
    }

    private Task RenderAsync(object? extra = null)
    {
        if (!_pageReady || _webView.CoreWebView2 is null)
        {
            return Task.CompletedTask;
        }

        var snapshot = _engine.Snapshot;
        var state = new
        {
            screen = _screen,
            compact = _inAppUpdate,
            version = snapshot.Version,
            installedVersion = snapshot.InstalledVersion,
            installDirectory = snapshot.InstallDirectory,
            requiredSpace = InstallerEngine.GetRequiredSpace(),
            availableSpace = InstallerEngine.GetAvailableSpace(snapshot.InstallDirectory),
            autoStart = snapshot.AutoStartEnabled,
            extra,
        };
        var json = JsonSerializer.Serialize(state);
        return ExecuteScriptAsync($"window.installShell.receive({json});");
    }

    private Task ExecuteScriptAsync(string script)
    {
        return _webView.CoreWebView2 is null
            ? Task.CompletedTask
            : _webView.CoreWebView2.ExecuteScriptAsync(script);
    }

    private static string LoadHtml()
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var htmlStream = assembly.GetManifestResourceStream("MyTodo.InstallerShell.installer.html")
            ?? throw new InvalidOperationException("安装界面资源缺失。");
        using var htmlReader = new StreamReader(htmlStream, Encoding.UTF8);
        var html = htmlReader.ReadToEnd();

        using var iconStream = assembly.GetManifestResourceStream("MyTodo.InstallerShell.MyTodo.ico")
            ?? throw new InvalidOperationException("安装图标资源缺失。");
        using var iconBuffer = new MemoryStream();
        iconStream.CopyTo(iconBuffer);
        var iconData = $"data:image/x-icon;base64,{Convert.ToBase64String(iconBuffer.ToArray())}";
        return html.Replace("{{ICON_DATA_URL}}", iconData, StringComparison.Ordinal);
    }

    private static Icon LoadIcon()
    {
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("MyTodo.InstallerShell.MyTodo.ico")
            ?? throw new InvalidOperationException("安装图标资源缺失。");
        using (stream)
        {
            using var sourceIcon = new Icon(stream);
            return (Icon)sourceIcon.Clone();
        }
    }

    private static class NativeMethods
    {
        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int valueSize);

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    }
}
