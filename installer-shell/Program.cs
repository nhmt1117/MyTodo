namespace MyTodo.InstallerShell;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(true, @"Local\MyTodo-InstallerShell", out var isFirstInstance);
        if (!isFirstInstance)
        {
            MessageBox.Show(
                "MyTodo 安装程序已经在运行。",
                "MyTodo 安装",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new InstallerForm(args));
    }
}
