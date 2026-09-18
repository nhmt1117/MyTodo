using System.Text;

namespace MyTodo.InstallerShell;

internal static class PayloadArchive
{
    private const int FooterSize = sizeof(long) + 16;
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("MYTODO-PAYLOAD-1");

    public static async Task<string> ExtractAsync(string destinationDirectory, CancellationToken cancellationToken)
    {
        var executablePath = Environment.ProcessPath
            ?? throw new InvalidOperationException("无法确定安装程序路径。");

        await using var source = new FileStream(
            executablePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        if (source.Length <= FooterSize)
        {
            throw new InvalidDataException("安装程序缺少安装数据。");
        }

        source.Seek(-FooterSize, SeekOrigin.End);
        var footer = new byte[FooterSize];
        await source.ReadExactlyAsync(footer, cancellationToken);

        var payloadLength = BitConverter.ToInt64(footer, 0);
        if (!footer.AsSpan(sizeof(long)).SequenceEqual(Magic)
            || payloadLength < 1024 * 1024
            || payloadLength > source.Length - FooterSize)
        {
            throw new InvalidDataException("安装数据校验失败，请重新下载安装包。");
        }

        Directory.CreateDirectory(destinationDirectory);
        var destinationPath = Path.Combine(destinationDirectory, "MyTodo-Backend-Setup.exe");
        source.Seek(source.Length - FooterSize - payloadLength, SeekOrigin.Begin);

        await using var destination = new FileStream(
            destinationPath,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        var buffer = new byte[1024 * 1024];
        var remaining = payloadLength;
        while (remaining > 0)
        {
            var read = await source.ReadAsync(
                buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)),
                cancellationToken);
            if (read == 0)
            {
                throw new EndOfStreamException("安装数据不完整，请重新下载安装包。");
            }

            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            remaining -= read;
        }

        await destination.FlushAsync(cancellationToken);
        return destinationPath;
    }
}
