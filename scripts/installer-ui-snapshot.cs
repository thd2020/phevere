using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

// Renders the setup window's content to a PNG without showing a window, for
// scripts/render-installer-ui.js. Compiled together with packaging/installer-ui/InstallerUi.cs.
// Usage: snapshot.exe <out.png> <options|hero> <x64|arm64> <width> <height> <version>
static class InstallerUiSnapshot
{
    [STAThread]
    static int Main(string[] args)
    {
        var options = new Dictionary<string, string> { { "preview", "true" }, { "fresh", "true" }, { "version", args[5] }, { "app-size", "472000000" } };
        if (args[1] != "hero") options["options"] = "true";
        options["arch"] = args[2];
        double width = double.Parse(args[3]), height = double.Parse(args[4]);
        var window = new SetupWindow(options);
        var root = (FrameworkElement)window.Content;
        window.Content = null;
        var size = new Size(width, height);
        root.Measure(size); root.Arrange(new Rect(size)); root.UpdateLayout();
        const double scale = 1.5;
        var bitmap = new RenderTargetBitmap((int)(width * scale), (int)(height * scale), 96 * scale, 96 * scale, PixelFormats.Pbgra32);
        bitmap.Render(root);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using (var file = File.Create(args[0])) encoder.Save(file);
        return 0;
    }
}
