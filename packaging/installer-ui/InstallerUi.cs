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
    readonly bool preview;
    readonly string backend, version, arch;
    readonly TextBox folder;
    readonly CheckBox ocr, desktop, startMenu, startup, launch, agreement;
    readonly ComboBox voice;
    readonly Grid stage;
    readonly ScrollViewer optionsPanel;
    readonly System.Windows.Controls.Image hero;
    readonly TextBlock heading, status;
    readonly Button next, custom, cancel, skip;
    readonly ProgressBar progress;
    bool installing, complete, audioFailed, optionsOpen;
    InstallChoices installedChoices;
    public int Result = 2;

    sealed class InstallChoices {
        public string Folder, Model;
        public bool Ocr, Desktop, StartMenu, Startup, Launch;
    }

    const string Layout = @"
<Grid xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' Background='#F4F0EA' TextOptions.TextFormattingMode='Display' TextOptions.TextRenderingMode='ClearType'>
 <Grid.Resources>
  <Style TargetType='TextBlock'><Setter Property='Foreground' Value='#1C1917'/><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='TextWrapping' Value='Wrap'/></Style>
  <Style TargetType='Button'><Setter Property='Foreground' Value='#1C1917'/><Setter Property='Background' Value='#FFFDF9'/><Setter Property='BorderBrush' Value='#D7C3BB'/><Setter Property='BorderThickness' Value='1'/><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='FontWeight' Value='SemiBold'/><Setter Property='Padding' Value='20,10'/><Setter Property='MinHeight' Value='42'/><Setter Property='Cursor' Value='Hand'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'><Border x:Name='Plate' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='7' Padding='{TemplateBinding Padding}'><ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center' RecognizesAccessKey='True'/></Border><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Plate' Property='Opacity' Value='0.86'/></Trigger><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Plate' Property='BorderBrush' Value='#9C3D00'/><Setter TargetName='Plate' Property='BorderThickness' Value='2'/></Trigger><Trigger Property='IsEnabled' Value='False'><Setter TargetName='Plate' Property='Opacity' Value='0.45'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType='CheckBox'><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='Foreground' Value='#1C1917'/><Setter Property='Margin' Value='0,8'/><Setter Property='Cursor' Value='Hand'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='CheckBox'><Grid><Grid.ColumnDefinitions><ColumnDefinition Width='28'/><ColumnDefinition Width='*'/></Grid.ColumnDefinitions><Border x:Name='Box' Width='19' Height='19' CornerRadius='5' BorderBrush='#85736C' BorderThickness='1' Background='#FFFDF9' VerticalAlignment='Center' HorizontalAlignment='Left'><Path x:Name='Tick' Data='M 3,8 L 7,12 L 14,4' Stroke='#FFF7F3' StrokeThickness='2' Visibility='Collapsed' VerticalAlignment='Center' HorizontalAlignment='Center'/></Border><ContentPresenter Grid.Column='1' VerticalAlignment='Center' RecognizesAccessKey='True'/></Grid><ControlTemplate.Triggers><Trigger Property='IsChecked' Value='True'><Setter TargetName='Box' Property='Background' Value='#9C3D00'/><Setter TargetName='Box' Property='BorderBrush' Value='#9C3D00'/><Setter TargetName='Tick' Property='Visibility' Value='Visible'/></Trigger><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Box' Property='BorderThickness' Value='2'/></Trigger><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Box' Property='BorderBrush' Value='#9C3D00'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter><Style.Triggers><Trigger Property='IsEnabled' Value='False'><Setter Property='Opacity' Value='0.45'/></Trigger></Style.Triggers></Style>
  <Style TargetType='TextBox'><Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='Padding' Value='12,10'/><Setter Property='Background' Value='#F6F2EC'/><Setter Property='BorderBrush' Value='#D7C3BB'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='TextBox'><Border x:Name='Plate' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='1' CornerRadius='7'><ScrollViewer x:Name='PART_ContentHost'/></Border><ControlTemplate.Triggers><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Plate' Property='BorderBrush' Value='#9C3D00'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType='ComboBox'>
   <Setter Property='FontFamily' Value='Segoe UI'/><Setter Property='FontSize' Value='14'/><Setter Property='MinHeight' Value='42'/><Setter Property='Foreground' Value='#1C1917'/>
   <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ComboBox'><Grid>
    <ToggleButton Focusable='False' IsChecked='{Binding IsDropDownOpen, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}'>
     <ToggleButton.Template><ControlTemplate TargetType='ToggleButton'><Border x:Name='ComboPlate' CornerRadius='7' Background='#F6F2EC' BorderBrush='#D7C3BB' BorderThickness='1'><Grid><Path Data='M 0,0 L 4,4 L 8,0' Stroke='#5C534E' StrokeThickness='1.5' HorizontalAlignment='Right' VerticalAlignment='Center' Margin='0,0,14,0'/></Grid></Border><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='ComboPlate' Property='BorderBrush' Value='#9C3D00'/></Trigger></ControlTemplate.Triggers></ControlTemplate></ToggleButton.Template>
    </ToggleButton>
    <ContentPresenter Margin='12,9,34,9' VerticalAlignment='Center' IsHitTestVisible='False' Content='{TemplateBinding SelectionBoxItem}' ContentTemplate='{TemplateBinding SelectionBoxItemTemplate}'/>
    <Border x:Name='KeyboardFocus' CornerRadius='7' BorderThickness='2' BorderBrush='Transparent' IsHitTestVisible='False'/>
    <Popup x:Name='PART_Popup' Placement='Bottom' IsOpen='{TemplateBinding IsDropDownOpen}' AllowsTransparency='True' Focusable='False'><Border MinWidth='{Binding ActualWidth, RelativeSource={RelativeSource TemplatedParent}}' MaxHeight='220' CornerRadius='7' BorderBrush='#D7C3BB' BorderThickness='1' Background='#FFFDF9' Padding='4'><ScrollViewer><ItemsPresenter KeyboardNavigation.DirectionalNavigation='Contained'/></ScrollViewer></Border></Popup>
   </Grid><ControlTemplate.Triggers><Trigger Property='IsKeyboardFocusWithin' Value='True'><Setter TargetName='KeyboardFocus' Property='BorderBrush' Value='#9C3D00'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style TargetType='ComboBoxItem'><Setter Property='Padding' Value='8,9'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ComboBoxItem'><Border x:Name='ItemPlate' Background='Transparent' CornerRadius='4' Padding='{TemplateBinding Padding}'><ContentPresenter/></Border><ControlTemplate.Triggers><Trigger Property='IsHighlighted' Value='True'><Setter TargetName='ItemPlate' Property='Background' Value='#FFDBCC'/></Trigger><Trigger Property='IsSelected' Value='True'><Setter Property='FontWeight' Value='SemiBold'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType='ScrollBar'><Setter Property='Width' Value='8'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ScrollBar'><Track x:Name='PART_Track' IsDirectionReversed='True'><Track.DecreaseRepeatButton><RepeatButton Command='ScrollBar.PageUpCommand'><RepeatButton.Template><ControlTemplate TargetType='RepeatButton'><Border Background='Transparent'/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.DecreaseRepeatButton><Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType='Thumb'><Border Background='#B8ACA1' CornerRadius='4' Opacity='0.7'/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb><Track.IncreaseRepeatButton><RepeatButton Command='ScrollBar.PageDownCommand'><RepeatButton.Template><ControlTemplate TargetType='RepeatButton'><Border Background='Transparent'/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.IncreaseRepeatButton></Track></ControlTemplate></Setter.Value></Setter></Style>
 </Grid.Resources>
 <Grid Margin='34,20,34,18'>
  <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='*'/><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/></Grid.RowDefinitions>
  <StackPanel Orientation='Horizontal' Margin='0,0,0,8'><TextBlock x:Name='Heading' Text='Phevere' FontSize='32' FontWeight='Bold'/><TextBlock x:Name='BuildLabel' FontSize='12' Foreground='#5C534E' VerticalAlignment='Bottom' Margin='12,0,0,8'/></StackPanel>
  <Grid x:Name='Stage' Grid.Row='1' Margin='0,0,0,10'>
   <Image x:Name='Hero' Stretch='Uniform' HorizontalAlignment='Stretch' VerticalAlignment='Center'/>
   <ScrollViewer x:Name='OptionsPanel' Visibility='Collapsed' VerticalScrollBarVisibility='Auto' HorizontalScrollBarVisibility='Disabled' Margin='14,8,14,6'/>
  </Grid>
  <StackPanel Grid.Row='2'>
   <TextBlock x:Name='Status' TextAlignment='Center' Foreground='#5C534E' FontSize='13' Margin='0,0,0,8' Visibility='Collapsed'/>
   <ProgressBar x:Name='Progress' Height='5' Maximum='1' Margin='52,0,52,16' Visibility='Collapsed' Foreground='#9C3D00' Background='#E0D8D0' BorderThickness='0'/>
   <Button x:Name='InstallButton' Content='_Install' Width='186' MinHeight='46' FontSize='16' Background='#9C3D00' Foreground='#FFF7F3' BorderBrush='#9C3D00' HorizontalAlignment='Center' IsDefault='True'/>
   <StackPanel Orientation='Horizontal' HorizontalAlignment='Center' Margin='0,6,0,8'>
    <Button x:Name='CustomOptions' Content='Custom options' FontSize='12' MinHeight='28' Padding='8,4' Background='Transparent' BorderThickness='0' Foreground='#5C534E'/>
    <Button x:Name='SkipModel' Content='Finish without model' FontSize='12' MinHeight='28' Padding='8,4' Background='Transparent' BorderThickness='0' Foreground='#5C534E' Visibility='Collapsed'/>
   </StackPanel>
  </StackPanel>
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
        backend = Get(options, "backend", ""); version = Get(options, "version", "2.1.0"); arch = Get(options, "arch", "x64");
        Title = "Phevere Setup";
        MaxWidth = SystemParameters.WorkArea.Width - 24; MaxHeight = SystemParameters.WorkArea.Height - 24;
        MinWidth = Math.Min(680, MaxWidth); MinHeight = Math.Min(520, MaxHeight);
        Width = Math.Min(820, MaxWidth); Height = Math.Min(600, MaxHeight);
        WindowStartupLocation = WindowStartupLocation.CenterScreen; ResizeMode = ResizeMode.CanMinimize;
        UseLayoutRounding = true; SnapsToDevicePixels = true;
        var root = (Grid)XamlReader.Parse(Layout); Content = root;
        heading = Find<TextBlock>(root, "Heading"); status = Find<TextBlock>(root, "Status");
        stage = Find<Grid>(root, "Stage"); hero = Find<System.Windows.Controls.Image>(root, "Hero"); optionsPanel = Find<ScrollViewer>(root, "OptionsPanel");
        next = Find<Button>(root, "InstallButton"); custom = Find<Button>(root, "CustomOptions"); cancel = Find<Button>(root, "CloseButton"); skip = Find<Button>(root, "SkipModel"); progress = Find<ProgressBar>(root, "Progress");
        agreement = Find<CheckBox>(root, "Agreement");
        var fontDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fonts") + Path.DirectorySeparatorChar;
        if (Directory.Exists(fontDirectory)) heading.FontFamily = new FontFamily(new Uri(fontDirectory, UriKind.Absolute), "#Outfit");
        Find<TextBlock>(root, "BuildLabel").Text = version;
        string art = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "hero.bmp");
        if (File.Exists(art)) {
            var bitmap = new System.Windows.Media.Imaging.BitmapImage(); bitmap.BeginInit(); bitmap.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad; bitmap.UriSource = new Uri(art); bitmap.EndInit(); bitmap.Freeze(); hero.Source = bitmap;
        }
        try { Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico"))); } catch { }
        folder = new TextBox { Text = ExistingFolder(), MinHeight = 42 };
        System.Windows.Automation.AutomationProperties.SetName(folder, "Installation folder");
        ocr = Choice("OCR models (15 MB)", ExistingChoice("OcrModels", Directory.Exists(Path.Combine(folder.Text, "resources", "ocr-models"))));
        desktop = Choice("Desktop shortcut", ExistingChoice("DesktopShortcut", File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "Phevere.lnk"))));
        startMenu = Choice("Start menu shortcuts", ExistingChoice("StartMenuShortcut", File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "Phevere.lnk"))));
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) startup = Choice("Start with Windows", key != null && key.GetValue("Phevere") != null);
        launch = Choice("Open after installation", true);
        voice = new ComboBox { MinHeight = 42 };
        voice.Items.Add("None"); voice.Items.Add("Kokoro Compact (132 MB)"); voice.Items.Add("Kokoro Full (350 MB)"); voice.SelectedIndex = ExistingVoice();
        System.Windows.Automation.AutomationProperties.SetName(voice, "Audio model");
        BuildOptions();
        custom.Click += delegate { optionsOpen = !optionsOpen; ShowStage(); };
        Find<Button>(root, "License").Click += delegate { try { Process.Start(new ProcessStartInfo("https://github.com/thd2020/phevere/blob/main/LICENSE") { UseShellExecute = true }); } catch (Exception error) { ShowStatus(error.Message, true); } };
        next.Click += Install;
        skip.Click += delegate {
            try {
                if (!preview) SaveAudioOptions("none", false);
                installedChoices.Model = "none";
                FinishInstall();
            } catch (Exception error) { ShowStatus(error.Message, true); }
        };
        cancel.Click += delegate { Close(); };
        Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (installing) e.Cancel = true; };
        ShowStage();
    }

    static T Find<T>(FrameworkElement root, string name) where T : class { return (T)root.FindName(name); }
    static string Get(Dictionary<string, string> options, string key, string fallback) { string value; return options.TryGetValue(key, out value) ? value : fallback; }
    static CheckBox Choice(string label, bool selected) { return new CheckBox { Content = label, IsChecked = selected, Margin = new Thickness(0, 8, 0, 8) }; }
    static bool On(CheckBox box) { return box.IsChecked == true; }

    void BuildOptions() {
        var panel = new StackPanel(); optionsPanel.Content = panel;
        panel.Children.Add(new TextBlock { Text = "Install location", FontSize = 13, Margin = new Thickness(0, 0, 0, 7) });
        var directoryRow = new Grid { Margin = new Thickness(0, 0, 0, 16) };
        directoryRow.ColumnDefinitions.Add(new ColumnDefinition()); directoryRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        directoryRow.Children.Add(folder);
        var browse = new Button { Content = "Browse…", Margin = new Thickness(10, 0, 0, 0), Padding = new Thickness(16, 8, 16, 8) }; Grid.SetColumn(browse, 1); directoryRow.Children.Add(browse);
        browse.Click += delegate { using (var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = "Install Phevere in", SelectedPath = folder.Text, ShowNewFolderButton = true }) if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK) folder.Text = dialog.SelectedPath; };
        panel.Children.Add(directoryRow); panel.Children.Add(ocr);
        if (arch != "arm64") {
            var voiceRow = new Grid { Margin = new Thickness(0, 7, 0, 16) };
            voiceRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(112) }); voiceRow.ColumnDefinitions.Add(new ColumnDefinition());
            voiceRow.Children.Add(new TextBlock { Text = "Audio model", FontSize = 13, VerticalAlignment = VerticalAlignment.Center });
            Grid.SetColumn(voice, 1); voiceRow.Children.Add(voice); panel.Children.Add(voiceRow);
        }
        var checks = new Grid(); checks.ColumnDefinitions.Add(new ColumnDefinition()); checks.ColumnDefinitions.Add(new ColumnDefinition()); checks.RowDefinitions.Add(new RowDefinition()); checks.RowDefinitions.Add(new RowDefinition());
        checks.Children.Add(desktop); Grid.SetColumn(startMenu, 1); checks.Children.Add(startMenu);
        Grid.SetRow(startup, 1); checks.Children.Add(startup); Grid.SetRow(launch, 1); Grid.SetColumn(launch, 1); checks.Children.Add(launch); panel.Children.Add(checks);
    }

    void ShowStage() {
        bool showOptions = optionsOpen && !installing && !complete && !audioFailed;
        hero.Visibility = showOptions ? Visibility.Collapsed : Visibility.Visible;
        optionsPanel.Visibility = showOptions ? Visibility.Visible : Visibility.Collapsed;
        custom.Content = showOptions ? "Hide options" : "Custom options";
    }

    void ShowStatus(string text, bool error) {
        status.Text = text; status.Visibility = String.IsNullOrEmpty(text) ? Visibility.Collapsed : Visibility.Visible;
        status.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(error ? "#9C3D00" : "#5C534E"));
    }

    InstallChoices Snapshot() {
        return new InstallChoices { Folder = folder.Text, Ocr = On(ocr), Desktop = On(desktop), StartMenu = On(startMenu), Startup = On(startup), Launch = On(launch), Model = arch == "arm64" ? "none" : voice.SelectedIndex == 2 ? "kokoro-full" : voice.SelectedIndex == 1 ? "kokoro-compact" : "none" };
    }

    void ValidateFolder() {
        string value = folder.Text.Trim();
        if (String.IsNullOrEmpty(value) || !Path.IsPathRooted(value) || value.IndexOf('"') >= 0 || value.IndexOf('\r') >= 0 || value.IndexOf('\n') >= 0) throw new Exception("Enter an absolute installation folder.");
        value = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar);
        if (value.Length < 6 || value.Equals(Path.GetPathRoot(value).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new Exception("Choose a dedicated application folder.");
        if (Directory.Exists(value) && !File.Exists(Path.Combine(value, "phevere.exe")) && Directory.GetFileSystemEntries(value).Length > 0) throw new Exception("Choose an empty folder or the existing Phevere folder.");
        folder.Text = value;
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
        if (!audioFailed) {
            try { ValidateFolder(); } catch (Exception error) { optionsOpen = true; ShowStage(); ShowStatus(error.Message, true); folder.Focus(); return; }
            if (!On(agreement)) { ShowStatus("Accept the MIT license to continue.", true); agreement.Focus(); return; }
            installedChoices = Snapshot();
        }
        bool retryAudio = audioFailed;
        installing = true; optionsOpen = false; audioFailed = false; next.Visibility = Visibility.Collapsed;
        custom.Visibility = Visibility.Collapsed; skip.Visibility = Visibility.Collapsed; cancel.IsEnabled = false; agreement.IsEnabled = false;
        progress.Visibility = Visibility.Visible; progress.IsIndeterminate = true; ShowStage();
        ShowStatus(retryAudio ? "Downloading audio model…" : "Installing Phevere…", false);
        try {
            if (!retryAudio) {
                string parameters = "/S --desktop-shortcut=" + (installedChoices.Desktop ? "1" : "0") + " --start-menu-shortcut=" + (installedChoices.StartMenu ? "1" : "0") + " --ocr-models=" + (installedChoices.Ocr ? "1" : "0") + " /D=" + installedChoices.Folder;
                int exit = preview ? await Task.Run(delegate { System.Threading.Thread.Sleep(750); return 0; }) : await Task.Run(delegate { return RunBackend(parameters); });
                if (exit != 0) throw new Exception("Installation returned error " + exit + ". Select Install to retry.");
                if (!preview) ApplyUserOptions(installedChoices);
            }
            if (installedChoices.Model != "none") {
                progress.IsIndeterminate = false; progress.Value = 0; ShowStatus("Downloading audio model…", false);
                try {
                    if (preview) {
                        for (int i = 1; i <= 5; i++) { await Task.Delay(200); progress.Value = i / 5.0; }
                    } else {
                        await Task.Run(delegate { DownloadAudio(installedChoices); });
                        SaveAudioOptions(installedChoices.Model, true);
                    }
                } catch (Exception error) {
                    audioFailed = true; Result = 0;
                    ShowStatus("Audio model download failed. " + error.Message, true);
                    next.Content = "Retry download"; next.Visibility = Visibility.Visible; skip.Visibility = Visibility.Visible;
                    progress.Visibility = Visibility.Collapsed; return;
                }
            }
            FinishInstall();
        } catch (Exception error) {
            ShowStatus(error.Message, true); next.Content = "_Install"; next.Visibility = Visibility.Visible;
            custom.Visibility = Visibility.Visible; agreement.IsEnabled = true; progress.Visibility = Visibility.Collapsed;
        } finally { installing = false; cancel.IsEnabled = true; ShowStage(); }
    }

    void FinishInstall() {
        complete = true; audioFailed = false; Result = 0; optionsOpen = false;
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

    void DownloadAudio(InstallChoices choices) {
        string failure = null; bool finished = false;
        var info = new ProcessStartInfo(Path.Combine(choices.Folder, "phevere.exe"), "--install-audio-model=" + choices.Model) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = choices.Folder
        };
        using (var process = new Process { StartInfo = info }) {
            process.ErrorDataReceived += delegate { }; // Drain diagnostics so redirected stderr cannot block the subprocess.
            process.Start(); process.BeginErrorReadLine();
            string line;
            while ((line = process.StandardOutput.ReadLine()) != null) {
                try {
                    var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line);
                    object kind; if (!data.TryGetValue("event", out kind)) continue;
                    if ((string)kind == "audio-model-error") { object error; failure = data.TryGetValue("error", out error) ? Convert.ToString(error) : "Download failed."; }
                    if ((string)kind == "audio-model-complete") finished = true;
                    if ((string)kind == "audio-model-progress" || (string)kind == "audio-model-complete") {
                        object value; double amount = data.TryGetValue("progress", out value) ? Convert.ToDouble(value) : 0;
                        amount = Math.Max(0, Math.Min(1, amount));
                        Dispatcher.BeginInvoke(new Action(delegate { progress.Value = amount; ShowStatus("Downloading audio model… " + Math.Round(amount * 100) + "%", false); }));
                    }
                } catch { /* Ordinary application log lines are not installer protocol events. */ }
            }
            process.WaitForExit();
            if (process.ExitCode != 0 || !finished || failure != null) throw new Exception(failure ?? "Select Retry download to try again.");
        }
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
    bool ExistingChoice(string name, bool inferred) {
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 }) using (var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view)) using (var key = root.OpenSubKey(@"Software\" + AppGuid)) {
            var value = key == null ? null : key.GetValue(name) as string;
            if (value == "1" || value == "0") return value == "1";
        }
        return File.Exists(Path.Combine(folder.Text, "phevere.exe")) ? inferred : true;
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
