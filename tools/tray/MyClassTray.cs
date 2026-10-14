// MyClass 托盤程式（Windows）
// 在背景隱藏啟動伺服器（MyClassV*.exe --background），並在右下角通知區顯示圖示與選單。
// 以 Windows 內建的 .NET Framework 4 編譯器（csc.exe）建置，不需要額外安裝 SDK；語法限制為 C# 5。
//
// 參數：
//   (無)         開啟托盤；第一次啟動時自動開啟瀏覽器
//   --autostart  開機自動啟動用：只在背景執行，不開瀏覽器
//   --exit       結束執行中的托盤與伺服器（安裝／解除安裝程式使用）
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MyClass
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
            ServicePointManager.ServerCertificateValidationCallback = delegate { return true; }; // 只連 localhost 的自簽憑證

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            bool autostart = args.Contains("--autostart");

            // 建置用：以程式內繪製的圖示產生 .ico（含 16/32/48/256 四種尺寸，PNG 壓縮）
            if (args.Length == 2 && args[0] == "--make-icon")
            {
                IconFactory.WriteIco(args[1]);
                return 0;
            }

            if (args.Contains("--exit"))
            {
                Runtime.StopEverything(baseDir);
                return 0;
            }

            // 每個安裝資料夾只允許一個托盤；再次點捷徑時只開啟瀏覽器
            bool created;
            string name = "MyClass.Tray." + Math.Abs(baseDir.ToLowerInvariant().GetHashCode());
            Mutex mutex = new Mutex(true, name, out created);
            if (!created)
            {
                if (!autostart)
                {
                    RuntimeInfo info = Runtime.Read(baseDir);
                    if (info != null) Runtime.OpenBrowser(info.LocalUrl);
                    else MessageBox.Show("MyClass 正在啟動中，請稍候幾秒再試。", "MyClass", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayContext(baseDir, autostart));
            GC.KeepAlive(mutex);
            return 0;
        }
    }

    internal class RuntimeInfo
    {
        public int Pid;
        public int Port;
        public string Token;
        public string LocalUrl;
        public string LanUrl;
    }

    internal static class Runtime
    {
        public static string RuntimePath(string baseDir) { return Path.Combine(baseDir, "bin", "runtime.json"); }

        public static RuntimeInfo Read(string baseDir)
        {
            try
            {
                string path = RuntimePath(baseDir);
                if (!File.Exists(path)) return null;
                string json = File.ReadAllText(path, Encoding.UTF8);
                RuntimeInfo info = new RuntimeInfo();
                info.Pid = int.Parse(Regex.Match(json, "\"pid\"\\s*:\\s*(\\d+)").Groups[1].Value);
                info.Port = int.Parse(Regex.Match(json, "\"port\"\\s*:\\s*(\\d+)").Groups[1].Value);
                info.Token = Regex.Match(json, "\"token\"\\s*:\\s*\"([^\"]+)\"").Groups[1].Value;
                info.LocalUrl = Regex.Match(json, "\"local_url\"\\s*:\\s*\"([^\"]+)\"").Groups[1].Value;
                info.LanUrl = Regex.Match(json, "\"lan_url\"\\s*:\\s*\"([^\"]+)\"").Groups[1].Value;
                return info;
            }
            catch { return null; }
        }

        public static void OpenBrowser(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch { /* 沒有預設瀏覽器時忽略 */ }
        }

        public static bool RequestShutdown(RuntimeInfo info)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://127.0.0.1:" + info.Port + "/api/system/shutdown");
                req.Method = "POST";
                req.ContentLength = 0;
                req.Timeout = 3000;
                req.Headers["x-myclass-token"] = info.Token;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return (int)res.StatusCode == 200;
                }
            }
            catch { return false; }
        }

        public static bool IsAlive(int pid)
        {
            try { Process.GetProcessById(pid); return true; }
            catch { return false; }
        }

        /// <summary>安全關閉伺服器：先請它自己收尾，等不到再強制結束。</summary>
        public static void StopServer(string baseDir)
        {
            RuntimeInfo info = Read(baseDir);
            if (info == null) return;
            RequestShutdown(info);
            for (int i = 0; i < 20 && IsAlive(info.Pid); i++) Thread.Sleep(250);
            if (IsAlive(info.Pid))
            {
                try { Process.GetProcessById(info.Pid).Kill(); } catch { }
            }
        }

        /// <summary>--exit：先結束其他托盤（避免它自動重啟伺服器），再關閉伺服器。</summary>
        public static void StopEverything(string baseDir)
        {
            string me = Process.GetCurrentProcess().MainModule.FileName;
            foreach (Process p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(me)))
            {
                try
                {
                    if (p.Id == Process.GetCurrentProcess().Id) continue;
                    if (string.Equals(p.MainModule.FileName, me, StringComparison.OrdinalIgnoreCase)) p.Kill();
                }
                catch { }
            }
            StopServer(baseDir);
        }
    }

    internal class TrayContext : ApplicationContext
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "MyClass";

        private readonly string baseDir;
        private readonly bool autostart;
        private readonly NotifyIcon tray;
        private readonly ToolStripMenuItem statusItem;
        private readonly ToolStripMenuItem autostartItem;
        private readonly System.Windows.Forms.Timer timer;
        private readonly object logLock = new object();

        private Process server;
        private RuntimeInfo info;
        private bool quitting;
        private bool firstOpenDone;
        private DateTime lastRestartWindow = DateTime.MinValue;
        private int restartCount;
        private bool gaveUp;

        public TrayContext(string baseDir, bool autostart)
        {
            this.baseDir = baseDir;
            this.autostart = autostart;

            ContextMenuStrip menu = new ContextMenuStrip();
            statusItem = new ToolStripMenuItem("啟動中…");
            statusItem.Enabled = false;
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem open = new ToolStripMenuItem("開啟 MyClass");
            open.Font = new Font(open.Font, FontStyle.Bold);
            open.Click += delegate { OpenApp(); };
            menu.Items.Add(open);
            menu.Items.Add("複製學生連線網址（區網）", null, delegate { CopyLanUrl(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("開啟檔案資料夾（學生上傳的檔案）", null, delegate { OpenFolder(Path.Combine(baseDir, "bin", "uploads")); });
            menu.Items.Add("開啟資料資料夾（bin）", null, delegate { OpenFolder(Path.Combine(baseDir, "bin")); });
            menu.Items.Add("開啟執行記錄", null, delegate { OpenFolder(Path.Combine(baseDir, "bin", "logs")); });
            menu.Items.Add("開啟資料庫備份資料夾（升級前自動備份）", null, delegate { OpenFolder(Path.Combine(baseDir, "bin", "backups")); });
            menu.Items.Add(new ToolStripSeparator());
            autostartItem = new ToolStripMenuItem("開機時自動啟動");
            autostartItem.Click += delegate { ToggleAutostart(); };
            menu.Items.Add(autostartItem);
            menu.Items.Add("重新啟動伺服器", null, delegate { RestartServer(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("結束 MyClass", null, delegate { Quit(); });
            menu.Opening += delegate { RefreshMenu(); };

            tray = new NotifyIcon();
            // 優先使用本程式（MyClass.exe）內嵌的圖示（建置時由 assets/myclass.ico 嵌入，來源為 logo.svg）；
            // 取不到時才使用程式內繪製的備用圖示。
            Icon exeIcon = null;
            try { exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            tray.Icon = exeIcon != null ? exeIcon : IconFactory.Create(32);
            tray.Text = "MyClass 啟動中…";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenApp(); };

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 1000;
            timer.Tick += delegate { Tick(); };

            StartServer();
            timer.Start();
        }

        private string LogDir { get { return Path.Combine(baseDir, "bin", "logs"); } }

        private void Log(string line)
        {
            try
            {
                lock (logLock)
                {
                    Directory.CreateDirectory(LogDir);
                    string path = Path.Combine(LogDir, "server.log");
                    FileInfo fi = new FileInfo(path);
                    if (fi.Exists && fi.Length > 2 * 1024 * 1024)
                    {
                        string old = Path.Combine(LogDir, "server.1.log");
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(path, old);
                    }
                    File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch { /* 記錄失敗不應影響程式 */ }
        }

        private string FindServerExe()
        {
            string self = Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName);
            return Directory.GetFiles(baseDir, "MyClassV*.exe")
                .Where(f => !string.Equals(Path.GetFileName(f), self, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(f => File.GetLastWriteTime(f))
                .FirstOrDefault();
        }

        private void StartServer()
        {
            gaveUp = false;
            string exe = FindServerExe();
            if (exe == null)
            {
                MessageBox.Show("找不到伺服器程式（MyClassV*.exe），請重新安裝 MyClass。", "MyClass", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitThread();
                return;
            }

            // 資料夾裡已經有另一個伺服器在跑（例如先前沒關乾淨）：沿用它，不重複啟動
            RuntimeInfo existing = Runtime.Read(baseDir);
            if (existing != null && Runtime.IsAlive(existing.Pid))
            {
                info = existing;
                server = null;
                Log("沿用既有的伺服器 pid=" + existing.Pid);
                return;
            }

            ProcessStartInfo psi = new ProcessStartInfo(exe, "--background");
            psi.WorkingDirectory = baseDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            try
            {
                info = null;
                server = Process.Start(psi);
                server.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                server.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log("[stderr] " + e.Data); };
                server.BeginOutputReadLine();
                server.BeginErrorReadLine();
                Log("啟動伺服器 " + Path.GetFileName(exe) + " pid=" + server.Id);
            }
            catch (Exception ex)
            {
                Log("啟動失敗：" + ex.Message);
                gaveUp = true;
                tray.ShowBalloonTip(5000, "MyClass", "伺服器無法啟動：" + ex.Message, ToolTipIcon.Error);
            }
        }

        private void Tick()
        {
            if (quitting) return;

            if (info == null)
            {
                RuntimeInfo r = Runtime.Read(baseDir);
                if (r != null && (server == null ? Runtime.IsAlive(r.Pid) : r.Pid == server.Id))
                {
                    info = r;
                    tray.Text = "MyClass 執行中（埠 " + r.Port + "）";
                    if (!firstOpenDone)
                    {
                        firstOpenDone = true;
                        if (!autostart) Runtime.OpenBrowser(r.LocalUrl);
                        tray.ShowBalloonTip(3000, "MyClass", "系統已在背景執行。\n右下角圖示可開啟、複製學生連線網址或結束。", ToolTipIcon.Info);
                    }
                }
            }

            bool dead = server != null ? server.HasExited : (info != null && !Runtime.IsAlive(info.Pid));
            if (dead && !gaveUp)
            {
                Log("伺服器已結束，準備重新啟動");
                info = null;
                DateTime now = DateTime.Now;
                if ((now - lastRestartWindow).TotalSeconds > 60) { lastRestartWindow = now; restartCount = 0; }
                restartCount++;
                if (restartCount > 3)
                {
                    gaveUp = true;
                    tray.Text = "MyClass 已停止";
                    tray.ShowBalloonTip(6000, "MyClass", "伺服器反覆結束，已停止自動重啟。請從選單查看執行記錄，或選「重新啟動伺服器」。", ToolTipIcon.Error);
                    return;
                }
                server = null;
                StartServer();
            }
        }

        private void RefreshMenu()
        {
            statusItem.Text = info != null ? "● 執行中　" + info.LocalUrl : (gaveUp ? "○ 已停止" : "… 啟動中");
            autostartItem.Checked = IsAutostart();
        }

        private void OpenApp()
        {
            if (info != null) Runtime.OpenBrowser(info.LocalUrl);
            else tray.ShowBalloonTip(2000, "MyClass", "伺服器啟動中，請稍候幾秒。", ToolTipIcon.Info);
        }

        private void CopyLanUrl()
        {
            if (info == null || string.IsNullOrEmpty(info.LanUrl)) return;
            try
            {
                Clipboard.SetText(info.LanUrl);
                tray.ShowBalloonTip(2500, "MyClass", "已複製：" + info.LanUrl + "\n請貼給學生，或在系統內顯示 QR Code。", ToolTipIcon.Info);
            }
            catch { }
        }

        private void OpenFolder(string path)
        {
            try
            {
                Directory.CreateDirectory(path);
                Process.Start("explorer.exe", "\"" + path + "\"");
            }
            catch { }
        }

        private bool IsAutostart()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, false))
            {
                return k != null && k.GetValue(RunValue) != null;
            }
        }

        private void ToggleAutostart()
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (IsAutostart()) k.DeleteValue(RunValue, false);
                else k.SetValue(RunValue, "\"" + Process.GetCurrentProcess().MainModule.FileName + "\" --autostart");
            }
        }

        private void RestartServer()
        {
            Log("使用者要求重新啟動伺服器");
            quitting = true;
            Runtime.StopServer(baseDir);
            info = null;
            server = null;
            quitting = false;
            firstOpenDone = true;
            restartCount = 0;
            StartServer();
        }

        private void Quit()
        {
            quitting = true;
            timer.Stop();
            tray.Text = "MyClass 正在結束…";
            Runtime.StopServer(baseDir);
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }
    }

    internal static class IconFactory
    {
        /// <summary>程式內繪製的圖示（藍色圓角方塊與白色「T」），托盤與安裝程式用的 .ico 都用同一個設計。</summary>
        public static Icon Create(int size)
        {
            using (Bitmap bmp = Draw(size))
            {
                IntPtr h = bmp.GetHicon();
                return Icon.FromHandle(h);
            }
        }

        public static void WriteIco(string path)
        {
            int[] sizes = new int[] { 16, 32, 48, 256 };
            byte[][] pngs = new byte[sizes.Length][];
            for (int i = 0; i < sizes.Length; i++)
            {
                using (Bitmap bmp = Draw(sizes[i]))
                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                    pngs[i] = ms.ToArray();
                }
            }
            using (FileStream fs = new FileStream(path, FileMode.Create))
            using (BinaryWriter w = new BinaryWriter(fs))
            {
                w.Write((short)0);
                w.Write((short)1);
                w.Write((short)sizes.Length);
                int offset = 6 + 16 * sizes.Length;
                for (int i = 0; i < sizes.Length; i++)
                {
                    w.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                    w.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                    w.Write((byte)0);
                    w.Write((byte)0);
                    w.Write((short)1);
                    w.Write((short)32);
                    w.Write(pngs[i].Length);
                    w.Write(offset);
                    offset += pngs[i].Length;
                }
                for (int i = 0; i < sizes.Length; i++) w.Write(pngs[i]);
            }
        }

        public static Bitmap Draw(int size)
        {
            Bitmap bmp = new Bitmap(size, size);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                g.Clear(Color.Transparent);
                float r = size * 0.22f;
                RectangleF rect = new RectangleF(0, 0, size - 1, size - 1);
                using (GraphicsPath path = new GraphicsPath())
                {
                    path.AddArc(rect.X, rect.Y, r * 2, r * 2, 180, 90);
                    path.AddArc(rect.Right - r * 2, rect.Y, r * 2, r * 2, 270, 90);
                    path.AddArc(rect.Right - r * 2, rect.Bottom - r * 2, r * 2, r * 2, 0, 90);
                    path.AddArc(rect.X, rect.Bottom - r * 2, r * 2, r * 2, 90, 90);
                    path.CloseFigure();
                    using (LinearGradientBrush br = new LinearGradientBrush(rect, Color.FromArgb(56, 189, 248), Color.FromArgb(2, 132, 199), 90f))
                    {
                        g.FillPath(br, path);
                    }
                }
                using (Font f = new Font("Segoe UI", size * 0.55f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (StringFormat sf = new StringFormat())
                {
                    sf.Alignment = StringAlignment.Center;
                    sf.LineAlignment = StringAlignment.Center;
                    g.DrawString("T", f, Brushes.White, new RectangleF(0, size * 0.02f, size, size), sf);
                }
            }
            return bmp;
        }
    }
}
