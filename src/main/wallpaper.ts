import { execFile } from 'node:child_process'

/**
 * Puts a window behind the desktop icons, the way live-wallpaper apps do:
 * ask Progman to spawn its WorkerW layer (message 0x052C), find it, and make
 * our window its child. On Windows 11 24H2+ the WorkerW is a child of Progman;
 * before that it is the top-level WorkerW following the one that hosts the
 * icons (SHELLDLL_DefView).
 */
const CS = `
using System;
using System.Runtime.InteropServices;
public static class TpDesk {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string n);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr c, IntPtr p);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr h, IntPtr r, IntPtr g, uint f);

  static IntPtr Worker(out string mode) {
    IntPtr progman = FindWindow("Progman", null);
    IntPtr r;
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out r);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
    IntPtr worker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
    mode = "24h2";
    if (worker == IntPtr.Zero) {
      mode = "classic";
      IntPtr found = IntPtr.Zero;
      EnumWindows(delegate (IntPtr top, IntPtr l) {
        if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) found = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
        return true;
      }, IntPtr.Zero);
      worker = found;
    }
    return worker;
  }

  public static string Attach(long hwnd, int x, int y, int w, int h) {
    SetProcessDPIAware();
    string mode;
    IntPtr worker = Worker(out mode);
    if (worker == IntPtr.Zero) return "error:no-workerw";
    IntPtr win = new IntPtr(hwnd);
    int style = GetWindowLong(win, -16);
    SetWindowLong(win, -16, (int)((style & ~0x80000000 & ~0x00C00000) | 0x40000000));
    SetParent(win, worker);
    SetWindowPos(win, IntPtr.Zero, x - GetSystemMetrics(76), y - GetSystemMetrics(77), w, h, 0x0040 | 0x0010);
    return (GetParent(win) == worker ? "ok:" : "error:parent:") + mode;
  }

  public static string Refresh() {
    string mode;
    IntPtr worker = Worker(out mode);
    if (worker != IntPtr.Zero) RedrawWindow(worker, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0004 | 0x0080 | 0x0100);
    return "ok";
  }
}
`

function powershell(body: string): Promise<string> {
  const script = `Add-Type -TypeDefinition @'\n${CS}\n'@\n${body}`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 20000 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim()))
    )
  })
}

/** Reads the HWND out of BrowserWindow.getNativeWindowHandle() */
export const hwndOf = (handle: Buffer): bigint => (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0)))

/** `rect` in physical pixels (screen.dipToScreenRect) */
export async function attachToDesktop(hwnd: bigint, rect: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean; detail: string }> {
  if (process.platform !== 'win32') return { ok: false, detail: '仅支持 Windows' }
  try {
    const out = await powershell(`[TpDesk]::Attach(${hwnd}, ${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.width)}, ${Math.round(rect.height)})`)
    return { ok: out.startsWith('ok'), detail: out }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}

/** Repaints the desktop after the wallpaper window is gone (the user's own wallpaper setting is left alone) */
export async function refreshDesktop(): Promise<void> {
  if (process.platform !== 'win32') return
  await powershell('[TpDesk]::Refresh()').catch(() => {})
}
