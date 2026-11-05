using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using Microsoft.Win32;

internal static class InstallerUi
{
    [STAThread]
    public static int Main(string[] args)
    {
        try {
            var options = new Dictionary<string, string>();
            for (int i = 0; i < args.Length; i++) {
                if (!args[i].StartsWith("--")) continue;
                string key = args[i].Substring(2);
                options[key] = i + 1 < args.Length && !args[i + 1].StartsWith("--") ? args[++i] : "true";
            }
            var app = new Application();
            var window = new SetupWindow(options);
            app.Run(window);
            return window.Result;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Phevere Setup", MessageBoxButton.OK, MessageBoxImage.Error);
            return 1;
        }
    }
}

internal sealed class SetupWindow : Window
{
    const string AppGuid = "45fdcc76-b0c6-5190-9341-af94f7ccbc13";
    /// <summary>PP-OCRv4 pack size on disk; keep in step with src/services/ocr-pack-manifest.json.</summary>
    const long OcrPackBytes = 15594089;
    readonly bool preview, fresh, ocrInstalled;
    readonly string backend, version, arch;
    /// <summary>Installed application size in bytes, passed by the setup shell (--app-size).</summary>
    readonly long appBytes;
    readonly TextBox folder;
    readonly CheckBox ocr, desktop, startMenu, startup, launch, agreement;
    /// <summary>Pronunciation voice: None, Standard, High quality (index 0, 1, 2).</summary>
    readonly RadioButton[] voices;
    readonly Grid stage;
    readonly ScrollViewer optionsPanel;
    readonly System.Windows.Controls.Image hero;
    readonly TextBlock heading, status, space;
    readonly StackPanel actions, links;
    FontFamily display;
    readonly Button next, custom, cancel, skip;
    readonly ProgressBar progress;
    bool installing, complete, downloadFailed, optionsOpen;
    InstallChoices installedChoices;
    readonly Queue<Download> downloads = new Queue<Download>();
    public int Result = 2;

    sealed class InstallChoices {
        public string Folder, Model;
        public bool Ocr, Desktop, StartMenu, Startup, Launch;
    }

    /// <summary>An optional download that runs through phevere.exe after the app is installed.</summary>
    sealed class Download {
        public string Name, Argument, Event;
        public Action Done, Skipped;
    }

    const string Layout = @"
<Grid xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' Background='#F4F0EA' TextOptions.TextFormattingMode='Display' TextOptions.TextRenderingMode='ClearType'>
 <Grid.Resources>
  <Style TargetType='TextBlock'><Setter Property='Foreground' Value='#1C1917'/><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='TextWrapping' Value='Wrap'/></Style>
  <Style TargetType='Button'><Setter Property='Foreground' Value='#1C1917'/><Setter Property='Background' Value='#FFFDF9'/><Setter Property='BorderBrush' Value='#D7C3BB'/><Setter Property='BorderThickness' Value='1'/><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='FontWeight' Value='SemiBold'/><Setter Property='Padding' Value='20,10'/><Setter Property='MinHeight' Value='42'/><Setter Property='Cursor' Value='Hand'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'><Border x:Name='Plate' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='7' Padding='{TemplateBinding Padding}'><ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center' RecognizesAccessKey='True'/></Border><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Plate' Property='Opacity' Value='0.86'/></Trigger><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Plate' Property='BorderBrush' Value='#9C3D00'/><Setter TargetName='Plate' Property='BorderThickness' Value='2'/></Trigger><Trigger Property='IsEnabled' Value='False'><Setter TargetName='Plate' Property='Opacity' Value='0.45'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType='CheckBox'><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='Foreground' Value='#1C1917'/><Setter Property='Padding' Value='0'/><Setter Property='Margin' Value='0'/><Setter Property='Cursor' Value='Hand'/><Setter Property='FocusVisualStyle' Value='{x:Null}'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='CheckBox'><Grid Background='Transparent'><Border x:Name='Ring' Margin='-6,-3' CornerRadius='6' BorderThickness='2' BorderBrush='Transparent'/><Grid Margin='{TemplateBinding Padding}'><Grid.ColumnDefinitions><ColumnDefinition Width='28'/><ColumnDefinition Width='*'/></Grid.ColumnDefinitions><Border x:Name='Box' Width='18' Height='18' Margin='0,1,0,0' CornerRadius='4' BorderBrush='#85736C' BorderThickness='1.5' Background='#FFFDF9' VerticalAlignment='Top' HorizontalAlignment='Left'><Path x:Name='Tick' Data='M 3.5,8.5 L 7,12 L 14,4.5' Stroke='#FFF7F3' StrokeThickness='2' StrokeStartLineCap='Round' StrokeEndLineCap='Round' StrokeLineJoin='Round' Visibility='Collapsed' VerticalAlignment='Center' HorizontalAlignment='Center'/></Border><ContentPresenter Grid.Column='1' VerticalAlignment='Center' HorizontalAlignment='{TemplateBinding HorizontalContentAlignment}' RecognizesAccessKey='True'/></Grid></Grid><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Box' Property='BorderBrush' Value='#9C3D00'/></Trigger><Trigger Property='IsChecked' Value='True'><Setter TargetName='Box' Property='Background' Value='#9C3D00'/><Setter TargetName='Box' Property='BorderBrush' Value='#9C3D00'/><Setter TargetName='Tick' Property='Visibility' Value='Visible'/></Trigger><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Ring' Property='BorderBrush' Value='#9C3D00'/></Trigger><Trigger Property='IsEnabled' Value='False'><Setter TargetName='Box' Property='Opacity' Value='0.5'/><Setter Property='Cursor' Value='Arrow'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType='RadioButton'><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='Foreground' Value='#1C1917'/><Setter Property='Padding' Value='0'/><Setter Property='Cursor' Value='Hand'/><Setter Property='FocusVisualStyle' Value='{x:Null}'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='RadioButton'><Grid Background='Transparent'><Border x:Name='Ring' Margin='-6,-3' CornerRadius='6' BorderThickness='2' BorderBrush='Transparent'/><Grid Margin='{TemplateBinding Padding}'><Grid.ColumnDefinitions><ColumnDefinition Width='28'/><ColumnDefinition Width='*'/></Grid.ColumnDefinitions><Grid Width='18' Height='18' Margin='0,1,0,0' VerticalAlignment='Top' HorizontalAlignment='Left'><Ellipse x:Name='Dial' Stroke='#85736C' StrokeThickness='1.5' Fill='#FFFDF9'/><Ellipse x:Name='Dot' Width='8' Height='8' Fill='#9C3D00' Visibility='Collapsed'/></Grid><ContentPresenter Grid.Column='1' VerticalAlignment='Center' HorizontalAlignment='{TemplateBinding HorizontalContentAlignment}' RecognizesAccessKey='True'/></Grid></Grid><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Dial' Property='Stroke' Value='#9C3D00'/></Trigger><Trigger Property='IsChecked' Value='True'><Setter TargetName='Dial' Property='Stroke' Value='#9C3D00'/><Setter TargetName='Dot' Property='Visibility' Value='Visible'/></Trigger><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Ring' Property='BorderBrush' Value='#9C3D00'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType='TextBox'><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='Padding' Value='8,0'/><Setter Property='Background' Value='#FFFDF9'/><Setter Property='BorderBrush' Value='#D7C3BB'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='TextBox'><Border x:Name='Plate' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='1' CornerRadius='6'><ScrollViewer x:Name='PART_ContentHost' VerticalAlignment='Center'/></Border><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Plate' Property='BorderBrush' Value='#85736C'/></Trigger><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Plate' Property='BorderBrush' Value='#9C3D00'/><Setter TargetName='Plate' Property='BorderThickness' Value='1,1,1,2'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType='ScrollBar'><Setter Property='Width' Value='8'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ScrollBar'><Track x:Name='PART_Track' IsDirectionReversed='True'><Track.DecreaseRepeatButton><RepeatButton Command='ScrollBar.PageUpCommand'><RepeatButton.Template><ControlTemplate TargetType='RepeatButton'><Border Background='Transparent'/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.DecreaseRepeatButton><Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType='Thumb'><Border Background='#B8ACA1' CornerRadius='4' Opacity='0.7'/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb><Track.IncreaseRepeatButton><RepeatButton Command='ScrollBar.PageDownCommand'><RepeatButton.Template><ControlTemplate TargetType='RepeatButton'><Border Background='Transparent'/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.IncreaseRepeatButton></Track></ControlTemplate></Setter.Value></Setter></Style>
 </Grid.Resources>
 <Grid Margin='34,20,34,18'>
  <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='*'/><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/></Grid.RowDefinitions>
  <StackPanel Orientation='Horizontal' Margin='0,0,0,8'><TextBlock x:Name='Heading' Text='Phevere' FontSize='32' FontWeight='Bold'/><TextBlock x:Name='BuildLabel' FontSize='12' Foreground='#5C534E' VerticalAlignment='Bottom' Margin='12,0,0,8'/></StackPanel>
  <Grid x:Name='Stage' Grid.Row='1' Margin='0,0,0,10'>
   <Image x:Name='Hero' Stretch='Uniform' HorizontalAlignment='Stretch' VerticalAlignment='Center'/>
   <ScrollViewer x:Name='OptionsPanel' Visibility='Collapsed' VerticalScrollBarVisibility='Auto' HorizontalScrollBarVisibility='Disabled' Margin='0,8,0,6'/>
  </Grid>
  <Grid Grid.Row='2'>
   <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/></Grid.RowDefinitions>
   <TextBlock x:Name='Status' TextAlignment='Center' Foreground='#5C534E' FontSize='13' Margin='0,0,0,8' Visibility='Collapsed'/>
   <ProgressBar x:Name='Progress' Grid.Row='1' Height='5' Maximum='1' Margin='52,0,52,16' Visibility='Collapsed' Foreground='#9C3D00' Background='#E0D8D0' BorderThickness='0'/>
   <Grid Grid.Row='2'>
    <TextBlock x:Name='Space' FontSize='12.5' Foreground='#5C534E' VerticalAlignment='Center' HorizontalAlignment='Left' Visibility='Collapsed'/>
    <StackPanel x:Name='Actions' HorizontalAlignment='Center'>
     <Button x:Name='InstallButton' Content='_Install' Width='186' MinHeight='46' FontSize='16' Background='#9C3D00' Foreground='#FFF7F3' BorderBrush='#9C3D00' HorizontalAlignment='Center' VerticalAlignment='Center' IsDefault='True'/>
     <StackPanel x:Name='Links' Orientation='Horizontal' HorizontalAlignment='Center' VerticalAlignment='Center' Margin='0,6,0,8'>
      <Button x:Name='CustomOptions' Content='Custom options' FontSize='12' MinHeight='28' Padding='8,4' Background='Transparent' BorderThickness='0' Foreground='#5C534E'/>
      <Button x:Name='SkipModel' Content='Finish without model' FontSize='12' MinHeight='28' Padding='8,4' Background='Transparent' BorderThickness='0' Foreground='#5C534E' Visibility='Collapsed'/>
     </StackPanel>
    </StackPanel>
   </Grid>
  </Grid>
  <Grid Grid.Row='3'>
   <StackPanel x:Name='AgreementPanel' Orientation='Horizontal' VerticalAlignment='Center'>
    <CheckBox x:Name='Agreement' Content='I agree to the' FontSize='12' Margin='0,0,0,0' IsChecked='True'/>
    <Button x:Name='License' Content='MIT license' FontSize='12' FontWeight='Normal' MinHeight='28' Padding='3,4' Background='Transparent' BorderThickness='0' Foreground='#9C3D00'/>
   </StackPanel>
   <Button x:Name='CloseButton' Content='Close' HorizontalAlignment='Right' FontSize='12' MinHeight='28' Padding='8,4' Background='Transparent' BorderThickness='0' Foreground='#5C534E'/>
  </Grid>
 </Grid>
</Grid>";

    public SetupWindow(Dictionary<string, string> options)
    {
        preview = options.ContainsKey("preview");
        // Preview only: show what a computer without Phevere sees.
        fresh = preview && options.ContainsKey("fresh");
        backend = Get(options, "backend", ""); version = Get(options, "version", "2.1.0"); arch = Get(options, "arch", "x64");
        long.TryParse(Get(options, "app-size", "0"), out appBytes);
        Title = "Phevere Setup";
        MaxWidth = SystemParameters.WorkArea.Width - 24; MaxHeight = SystemParameters.WorkArea.Height - 24;
        MinWidth = Math.Min(680, MaxWidth); MinHeight = Math.Min(560, MaxHeight);
        Width = Math.Min(840, MaxWidth); Height = Math.Min(640, MaxHeight);
        WindowStartupLocation = WindowStartupLocation.CenterScreen; ResizeMode = ResizeMode.CanMinimize;
        UseLayoutRounding = true; SnapsToDevicePixels = true;
        var root = (Grid)XamlReader.Parse(Layout); Content = root;
        heading = Find<TextBlock>(root, "Heading"); status = Find<TextBlock>(root, "Status");
        stage = Find<Grid>(root, "Stage"); hero = Find<System.Windows.Controls.Image>(root, "Hero"); optionsPanel = Find<ScrollViewer>(root, "OptionsPanel");
        next = Find<Button>(root, "InstallButton"); custom = Find<Button>(root, "CustomOptions"); cancel = Find<Button>(root, "CloseButton"); skip = Find<Button>(root, "SkipModel"); progress = Find<ProgressBar>(root, "Progress");
        space = Find<TextBlock>(root, "Space"); actions = Find<StackPanel>(root, "Actions"); links = Find<StackPanel>(root, "Links");
        agreement = Find<CheckBox>(root, "Agreement");
        var fontDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fonts") + Path.DirectorySeparatorChar;
        if (Directory.Exists(fontDirectory)) display = new FontFamily(new Uri(fontDirectory, UriKind.Absolute), "#Outfit");
        if (display != null) heading.FontFamily = display;
        Find<TextBlock>(root, "BuildLabel").Text = version;
        string art = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "hero.bmp");
        if (File.Exists(art)) {
            var bitmap = new System.Windows.Media.Imaging.BitmapImage(); bitmap.BeginInit(); bitmap.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad; bitmap.UriSource = new Uri(art); bitmap.EndInit(); bitmap.Freeze(); hero.Source = bitmap;
        }
        try { Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico"))); } catch { }
        folder = new TextBox { Text = fresh ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Phevere") : ExistingFolder(), MinHeight = 34, VerticalContentAlignment = VerticalAlignment.Center };
        System.Windows.Automation.AutomationProperties.SetName(folder, "Install location");
        // Start menu on, desktop off for a new install (the Windows default); an upgrade keeps the last choice.
        startMenu = Option("Start menu", null, ExistingChoice("StartMenuShortcut", File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "Phevere.lnk")), true));
        desktop = Option("Desktop", null, ExistingChoice("DesktopShortcut", File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "Phevere.lnk")), false));
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) startup = Option("Start with Windows", null, !fresh && key != null && key.GetValue("Phevere") != null);
        launch = Option("Open Phevere after setup", null, true);
        ocrInstalled = !fresh && OcrPackPresent(folder.Text);
        ocr = Option("OCR pack", "For hover lookup and Scan", ocrInstalled);
        if (ocrInstalled) ocr.IsEnabled = false;
        int savedVoice = fresh ? 0 : ExistingVoice();
        voices = new[] { Choice("None", null, savedVoice == 0), Choice("Standard", "132 MB", savedVoice == 1), Choice("High quality, recommended", "350 MB", savedVoice == 2) };
        BuildOptions();
        foreach (var box in new[] { ocr, desktop, startMenu, startup, launch }) { box.Checked += delegate { UpdateSpace(); }; box.Unchecked += delegate { UpdateSpace(); }; }
        foreach (var choice in voices) choice.Checked += delegate { UpdateSpace(); };
        UpdateSpace();
        custom.Click += delegate { optionsOpen = !optionsOpen; ShowStage(); if (optionsOpen) folder.Focus(); };
        Find<Button>(root, "License").Click += delegate { try { Process.Start(new ProcessStartInfo("https://github.com/thd2020/phevere/blob/main/LICENSE") { UseShellExecute = true }); } catch (Exception error) { ShowStatus(error.Message, true); } };
        next.Click += Install;
        skip.Click += SkipDownload;
        cancel.Click += delegate { Close(); };
        Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (installing) e.Cancel = true; };
        if (options.ContainsKey("options")) optionsOpen = true;
        ShowStage();
    }

    static T Find<T>(FrameworkElement root, string name) where T : class { return (T)root.FindName(name); }
    static string Get(Dictionary<string, string> options, string key, string fallback) { string value; return options.TryGetValue(key, out value) ? value : fallback; }
    static bool On(CheckBox box) { return box.IsChecked == true; }
    static Brush Hex(string value) { var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(value)); brush.Freeze(); return brush; }
    static readonly Brush Ink = Hex("#1C1917"), Muted = Hex("#5C534E"), Rule = Hex("#E6DCD3");

    /// <summary>One option: a checkbox with its label, an optional detail line under it, and a size at the end of the line.</summary>
    CheckBox Option(string title, string detail, bool selected) {
        var box = new CheckBox { Content = OptionText(title, detail), IsChecked = selected, HorizontalContentAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, 0, 0, 10) };
        box.Tag = ((Grid)box.Content).Children[1];
        System.Windows.Automation.AutomationProperties.SetName(box, detail == null ? title : title + ", " + detail);
        return box;
    }

    /// <summary>One choice of a radio group, with its size at the end of the line.</summary>
    RadioButton Choice(string title, string size, bool selected) {
        var choice = new RadioButton { Content = OptionText(title, null), GroupName = "Voice", IsChecked = selected, HorizontalContentAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, 0, 0, 8) };
        ((TextBlock)((Grid)choice.Content).Children[1]).Text = size ?? "";
        System.Windows.Automation.AutomationProperties.SetName(choice, size == null ? title : title + ", " + size);
        return choice;
    }

    static Grid OptionText(string title, string detail) {
        var text = new StackPanel();
        text.Children.Add(new TextBlock { Text = title, FontSize = 14, Foreground = Ink, TextWrapping = TextWrapping.Wrap });
        if (detail != null) text.Children.Add(new TextBlock { Text = detail, FontSize = 12.5, Foreground = Muted, Margin = new Thickness(0, 1, 0, 0), TextWrapping = TextWrapping.Wrap });
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(text);
        var size = new TextBlock { FontSize = 12.5, Foreground = Muted, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(12, 1, 0, 0) };
        Grid.SetColumn(size, 1); row.Children.Add(size);
        return row;
    }

    static void SetSize(CheckBox box, string text) { ((TextBlock)box.Tag).Text = text; }

    TextBlock SectionTitle(string text, double top) {
        var title = new TextBlock { Text = text, FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = Ink, Margin = new Thickness(0, top, 0, 10) };
        if (display != null) title.FontFamily = display;
        return title;
    }

    /// <summary>
    /// Custom options, laid out the way Inno Setup, JetBrains and Visual Studio Installer lay out
    /// theirs: the install folder in one field with Browse beside it, a rule, then plain groups of
    /// checkboxes under short headings in two columns (Shortcuts and Startup on the left, Downloads
    /// on the right, each with its size). No cards; the space required sits in the footer by Install.
    /// </summary>
    void BuildOptions() {
        var page = new Grid { Margin = new Thickness(0, 4, 0, 4) };
        for (int i = 0; i < 3; i++) page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        page.ColumnDefinitions.Add(new ColumnDefinition()); page.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) }); page.ColumnDefinitions.Add(new ColumnDefinition());
        optionsPanel.Content = page;

        var location = new StackPanel();
        var locationTitle = new Label { Content = "Install _location", Target = folder, Padding = new Thickness(0), Margin = new Thickness(0, 0, 0, 8), FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = Ink, FontFamily = display ?? new FontFamily("Segoe UI") };
        location.Children.Add(locationTitle);
        var directoryRow = new Grid();
        directoryRow.ColumnDefinitions.Add(new ColumnDefinition()); directoryRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        directoryRow.Children.Add(folder);
        var browse = new Button { Content = "_Browse…", Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(14, 0, 14, 0), MinHeight = 34, FontSize = 13.5 }; Grid.SetColumn(browse, 1); directoryRow.Children.Add(browse);
        browse.Click += delegate { using (var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = "Install Phevere in", SelectedPath = folder.Text, ShowNewFolderButton = true }) if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK) folder.Text = dialog.SelectedPath; };
        location.Children.Add(directoryRow);
        Grid.SetColumnSpan(location, 3); page.Children.Add(location);

        var rule = new Border { Height = 1, Background = Rule, Margin = new Thickness(0, 22, 0, 18) };
        Grid.SetRow(rule, 1); Grid.SetColumnSpan(rule, 3); page.Children.Add(rule);

        var left = new StackPanel();
        left.Children.Add(SectionTitle("Shortcuts", 0)); left.Children.Add(startMenu); left.Children.Add(desktop);
        left.Children.Add(SectionTitle("Startup", 12)); left.Children.Add(startup); left.Children.Add(launch);
        Grid.SetRow(left, 2); page.Children.Add(left);

        var right = new StackPanel();
        right.Children.Add(SectionTitle("Downloads", 0)); right.Children.Add(ocr);
        if (arch != "arm64") {
            // The voices are a radio group indented under its name, like a component's sub-options.
            var voiceTitle = new StackPanel { Margin = new Thickness(0, 4, 0, 8) };
            voiceTitle.Children.Add(new TextBlock { Text = "Pronunciation voice", FontSize = 14, Foreground = Ink });
            voiceTitle.Children.Add(new TextBlock { Text = "Kokoro neural voice", FontSize = 12.5, Foreground = Muted, Margin = new Thickness(0, 1, 0, 0) });
            right.Children.Add(voiceTitle);
            var group = new StackPanel { Margin = new Thickness(2, 0, 0, 0) };
            System.Windows.Automation.AutomationProperties.SetName(group, "Pronunciation voice");
            foreach (var choice in voices) group.Children.Add(choice);
            right.Children.Add(group);
        }
        Grid.SetRow(right, 2); Grid.SetColumn(right, 2); page.Children.Add(right);
    }

    static long Megabytes(long bytes) { return (bytes + 524288) / 1048576; }

    int VoiceIndex { get { return voices[2].IsChecked == true ? 2 : voices[1].IsChecked == true ? 1 : 0; } }

    void UpdateSpace() {
        SetSize(ocr, ocrInstalled ? "Installed" : "14 MB");
        long total = appBytes;
        if (On(ocr) && !ocrInstalled) total += OcrPackBytes;
        if (arch != "arm64") total += VoiceIndex == 2 ? 350L * 1048576 : VoiceIndex == 1 ? 132L * 1048576 : 0;
        space.Text = total > 0 ? "Space required: " + Megabytes(total).ToString("N0") + " MB" : "";
    }

    /// <summary>
    /// The hero page has a large centred Install with Custom options under it. With the options open,
    /// the footer becomes a wizard bar: space required on the left, Hide options and Install on the right.
    /// </summary>
    void ShowStage() {
        bool showOptions = optionsOpen && !installing && !complete && !downloadFailed;
        hero.Visibility = showOptions ? Visibility.Collapsed : Visibility.Visible;
        optionsPanel.Visibility = showOptions ? Visibility.Visible : Visibility.Collapsed;
        custom.Content = showOptions ? "Hide options" : "Custom options";
        space.Visibility = showOptions && space.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        actions.Children.Clear();
        if (showOptions) { actions.Children.Add(links); actions.Children.Add(next); } else { actions.Children.Add(next); actions.Children.Add(links); }
        actions.Orientation = showOptions ? Orientation.Horizontal : Orientation.Vertical;
        actions.HorizontalAlignment = showOptions ? HorizontalAlignment.Right : HorizontalAlignment.Center;
        actions.Margin = showOptions ? new Thickness(0, 4, 0, 14) : new Thickness(0);
        space.Margin = actions.Margin;
        links.Margin = showOptions ? new Thickness(0, 0, 10, 0) : new Thickness(0, 6, 0, 8);
        custom.FontSize = showOptions ? 13.5 : 12;
        next.Width = showOptions ? 132 : 186; next.MinHeight = showOptions ? 38 : 46; next.FontSize = showOptions ? 14 : 16;
    }

    void ShowStatus(string text, bool error) {
        status.Text = text; status.Visibility = String.IsNullOrEmpty(text) ? Visibility.Collapsed : Visibility.Visible;
        status.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(error ? "#9C3D00" : "#5C534E"));
    }

    InstallChoices Snapshot() {
        return new InstallChoices { Folder = folder.Text, Ocr = On(ocr) && !ocrInstalled, Desktop = On(desktop), StartMenu = On(startMenu), Startup = On(startup), Launch = On(launch), Model = arch == "arm64" ? "none" : VoiceIndex == 2 ? "kokoro-full" : VoiceIndex == 1 ? "kokoro-compact" : "none" };
    }

    void ValidateFolder() {
        string value = folder.Text.Trim();
        if (String.IsNullOrEmpty(value) || !Path.IsPathRooted(value) || value.IndexOf('"') >= 0 || value.IndexOf('\r') >= 0 || value.IndexOf('\n') >= 0) throw new Exception("Enter an absolute installation folder.");
        value = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar);
        if (value.Length < 6 || value.Equals(Path.GetPathRoot(value).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new Exception("Choose a dedicated application folder.");
        if (Directory.Exists(value) && !File.Exists(Path.Combine(value, "phevere.exe")) && Directory.GetFileSystemEntries(value).Length > 0) throw new Exception("Choose an empty folder or the existing Phevere folder.");
        folder.Text = value;
    }

    void BeginWork(string message) {
        installing = true; optionsOpen = false; downloadFailed = false; next.Visibility = Visibility.Collapsed;
        custom.Visibility = Visibility.Collapsed; skip.Visibility = Visibility.Collapsed; cancel.IsEnabled = false; agreement.IsEnabled = false;
        progress.Visibility = Visibility.Visible; progress.IsIndeterminate = true; ShowStage();
        ShowStatus(message, false);
    }

    async void Install(object sender, RoutedEventArgs args) {
        if (complete) {
            if (installedChoices.Launch && !preview) {
                try { Process.Start(new ProcessStartInfo(Path.Combine(installedChoices.Folder, "phevere.exe")) { UseShellExecute = true }); }
                catch (Exception error) { ShowStatus("Phevere could not open: " + error.Message, true); return; }
            }
            Result = 0; Close(); return;
        }
        if (installing) return;
        if (downloadFailed) { await ContinueDownloads(); return; }
        try { ValidateFolder(); } catch (Exception error) { optionsOpen = true; ShowStage(); ShowStatus(error.Message, true); folder.Focus(); return; }
        if (!On(agreement)) { ShowStatus("Accept the MIT license to continue.", true); agreement.Focus(); return; }
        installedChoices = Snapshot();
        BeginWork("Installing Phevere…");
        try {
            string parameters = "/S --desktop-shortcut=" + (installedChoices.Desktop ? "1" : "0") + " --start-menu-shortcut=" + (installedChoices.StartMenu ? "1" : "0") + " /D=" + installedChoices.Folder;
            int exit = preview ? await Task.Run(delegate { System.Threading.Thread.Sleep(750); return 0; }) : await Task.Run(delegate { return RunBackend(parameters); });
            if (exit != 0) throw new Exception("Installation returned error " + exit + ". Select Install to retry.");
            if (!preview) ApplyUserOptions(installedChoices);
        } catch (Exception error) {
            installing = false; cancel.IsEnabled = true;
            ShowStatus(error.Message, true); next.Content = "_Install"; next.Visibility = Visibility.Visible;
            custom.Visibility = Visibility.Visible; agreement.IsEnabled = true; progress.Visibility = Visibility.Collapsed;
            ShowStage(); return;
        }
        downloads.Clear();
        if (installedChoices.Ocr) downloads.Enqueue(new Download { Name = "OCR pack", Argument = "--install-ocr-pack", Event = "ocr-pack" });
        if (installedChoices.Model != "none") {
            string model = installedChoices.Model;
            downloads.Enqueue(new Download {
                Name = "pronunciation voice", Argument = "--install-audio-model=" + model, Event = "audio-model",
                Done = delegate { if (!preview) SaveAudioOptions(model, true); },
                Skipped = delegate { if (!preview) SaveAudioOptions("none", false); installedChoices.Model = "none"; },
            });
        }
        await ContinueDownloads();
    }

    /// <summary>Optional downloads run after the app is installed; a failure offers Retry or skipping that item.</summary>
    async Task ContinueDownloads() {
        BeginWork("Installing Phevere…");
        try {
            while (downloads.Count > 0) {
                var item = downloads.Peek();
                progress.IsIndeterminate = false; progress.Value = 0; ShowStatus("Downloading the " + item.Name + "…", false);
                try {
                    if (preview) {
                        for (int i = 1; i <= 5; i++) { await Task.Delay(200); progress.Value = i / 5.0; }
                    } else {
                        await Task.Run(delegate { RunDownload(item); });
                    }
                    if (item.Done != null) item.Done();
                    downloads.Dequeue();
                } catch (Exception error) {
                    downloadFailed = true; Result = 0;
                    ShowStatus("The " + item.Name + " did not download. " + error.Message, true);
                    next.Content = "Retry download"; next.Visibility = Visibility.Visible;
                    skip.Content = "Continue without it"; skip.Visibility = Visibility.Visible;
                    progress.Visibility = Visibility.Collapsed; return;
                }
            }
            FinishInstall();
        } finally { installing = false; cancel.IsEnabled = true; ShowStage(); }
    }

    async void SkipDownload(object sender, RoutedEventArgs args) {
        if (installing || downloads.Count == 0) return;
        try {
            var item = downloads.Dequeue();
            if (item.Skipped != null) item.Skipped();
            await ContinueDownloads();
        } catch (Exception error) { ShowStatus(error.Message, true); }
    }

    void FinishInstall() {
        complete = true; downloadFailed = false; Result = 0; optionsOpen = false;
        progress.Visibility = Visibility.Collapsed; custom.Visibility = Visibility.Collapsed; skip.Visibility = Visibility.Collapsed;
        next.Visibility = Visibility.Visible; next.Content = installedChoices.Launch ? "Open Phevere" : "Finish";
        ShowStatus("Phevere is installed.", false);
        Find<StackPanel>((Grid)Content, "AgreementPanel").Visibility = Visibility.Collapsed;
        ShowStage();
    }

    int RunBackend(string parameters) {
        if (!File.Exists(backend)) throw new Exception("The installation package is missing. Download Setup again.");
        var info = new ProcessStartInfo(backend, parameters) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
        using (var process = Process.Start(info)) { process.WaitForExit(); return process.ExitCode; }
    }

    /// <summary>Run phevere.exe with a download switch; it prints JSON lines named &lt;event&gt;-progress, -complete and -error.</summary>
    void RunDownload(Download item) {
        string failure = null; bool finished = false;
        var info = new ProcessStartInfo(Path.Combine(installedChoices.Folder, "phevere.exe"), item.Argument) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = installedChoices.Folder
        };
        using (var process = new Process { StartInfo = info }) {
            process.ErrorDataReceived += delegate { }; // Drain diagnostics so redirected stderr cannot block the subprocess.
            process.Start(); process.BeginErrorReadLine();
            string line;
            while ((line = process.StandardOutput.ReadLine()) != null) {
                try {
                    var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line);
                    object kind; if (!data.TryGetValue("event", out kind)) continue;
                    string name = (string)kind;
                    if (name == item.Event + "-error") { object error; failure = data.TryGetValue("error", out error) ? Convert.ToString(error) : "Download failed."; }
                    if (name == item.Event + "-complete") finished = true;
                    if (name == item.Event + "-progress" || name == item.Event + "-complete") {
                        object value; double amount = data.TryGetValue("progress", out value) ? Convert.ToDouble(value) : 0;
                        amount = Math.Max(0, Math.Min(1, amount));
                        Dispatcher.BeginInvoke(new Action(delegate { progress.Value = amount; ShowStatus("Downloading the " + item.Name + "… " + Math.Round(amount * 100) + "%", false); }));
                    }
                } catch { /* Ordinary application log lines are not installer protocol events. */ }
            }
            process.WaitForExit();
            if (process.ExitCode != 0 || !finished || failure != null) throw new Exception(failure ?? "Select Retry download to try again.");
        }
    }

    static bool OcrPackPresent(string installFolder) {
        string pack = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "phevere", "ocr-packs", "pp-ocrv4", "ch_PP-OCRv4_rec_infer.onnx");
        string legacy = Path.Combine(installFolder, "resources", "ocr-models", "ch_PP-OCRv4_rec_infer.onnx");
        return File.Exists(pack) || File.Exists(legacy);
    }

    void ApplyUserOptions(InstallChoices choices) {
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) {
            if (choices.Startup) key.SetValue("Phevere", "\"" + Path.Combine(choices.Folder, "phevere.exe") + "\""); else key.DeleteValue("Phevere", false);
        }
        if (arch == "arm64") return;
        SaveAudioOptions(choices.Model, false);
    }

    void SaveAudioOptions(string model, bool provisioned) {
        string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "phevere"); Directory.CreateDirectory(directory);
        string file = Path.Combine(directory, "install-options.json");
        var serializer = new JavaScriptSerializer(); var data = new Dictionary<string, object>();
        try { data = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(file)) ?? data; } catch { }
        object previous; if (!data.TryGetValue("audioModel", out previous) || previous as string != model) data.Remove("audioProvisioning");
        data["audioModel"] = model;
        if (provisioned) data["audioProvisioning"] = new Dictionary<string, object> { { "status", "complete" }, { "model", model } };
        File.WriteAllText(file, serializer.Serialize(data), new UTF8Encoding(false));
    }
    static string ExistingFolder() {
        foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser }) foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 }) {
            using (var root = RegistryKey.OpenBaseKey(hive, view)) using (var key = root.OpenSubKey(@"Software\" + AppGuid)) {
                var value = key == null ? null : key.GetValue("InstallLocation") as string;
                if (!String.IsNullOrEmpty(value) && File.Exists(Path.Combine(value, "phevere.exe"))) return value;
            }
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Phevere");
    }
    /// <summary>The saved choice, else what an older install left on disk, else the new-install default.</summary>
    bool ExistingChoice(string name, bool inferred, bool freshDefault) {
        if (fresh) return freshDefault;
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 }) using (var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view)) using (var key = root.OpenSubKey(@"Software\" + AppGuid)) {
            var value = key == null ? null : key.GetValue(name) as string;
            if (value == "1" || value == "0") return value == "1";
        }
        return File.Exists(Path.Combine(folder.Text, "phevere.exe")) ? inferred : freshDefault;
    }
    int ExistingVoice() {
        if (arch == "arm64") return 0;
        try {
            var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "phevere", "install-options.json");
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
            object value; if (data.TryGetValue("audioModel", out value)) return value as string == "kokoro-full" ? 2 : value as string == "kokoro-compact" ? 1 : 0;
        } catch { }
        return 0;
    }

}
