'use strict';
/**
 * 题库与讲义系统 · Electron 桌面版主进程
 *
 * 做法：Electron 只当"壳"，里面跑的还是原来那套纯 Node 服务。
 *   主进程 → 启动 server.js（内嵌 HTTP 服务）→ 窗口加载 http://127.0.0.1:端口
 * 前端一行代码都不用改，打包出来的仍然是一个完整的桌面程序。
 *
 * 数据目录：优先放 exe 同级（免安装版最方便，也能和 pkg 版共用），
 * 装到 Program Files 之类写不了的地方就自动改存到用户目录。
 *
 * @author zz_lxf
 */
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_TITLE = '题库与讲义系统';
const isPortable = !app.isPackaged;

/* ---------------- 数据目录 ---------------- */

/**
 * 选一个能写的数据目录：
 * exe 同级 data 优先（可写就用），否则退回用户目录。
 *
 * 注意免安装版：electron-builder 的 portable 会把程序解压到临时目录再运行，
 * process.execPath 指向的是临时目录，数据跟着写进去的话一退出就没了。
 * 它会把用户放 exe 的那个目录放在 PORTABLE_EXECUTABLE_DIR 里，用那个才对。
 */
function pickDataDir() {
  if (process.env.TIKU_DATA) return path.resolve(process.env.TIKU_DATA);
  const base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const sameDir = path.join(base, 'data');
  try {
    fs.mkdirSync(sameDir, { recursive: true });
    fs.accessSync(sameDir, fs.constants.W_OK);
    fs.writeFileSync(path.join(sameDir, '.wtest'), 'ok');
    fs.unlinkSync(path.join(sameDir, '.wtest'));
    return sameDir;
  } catch (e) {
    // 装在 Program Files 之类只读的地方，改存用户目录
    try {
      const ud = path.join(app.getPath('userData'), 'data');
      fs.mkdirSync(ud, { recursive: true });
      return ud;
    } catch (e2) {
      return path.join(app.getPath('userData'));
    }
  }
}

process.env.TIKU_DATA = pickDataDir();
process.env.TIKU_EMBEDDED = '1';   // 告诉 server.js 别自己再启一份

/* ---------------- 单实例 ---------------- */

if (!app.requestSingleInstanceLock()) {
  // 已经有一份在跑，直接退出（第二次双击时把已有窗口叫到前面）
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ---------------- 服务 ---------------- */

let mainWindow = null;
let backend = null;

async function startBackend() {
  // server.js 会自动启动（TIKU_EMBEDDED 已在上面设好，这里只等它返回）
  const mod = require('../server.js');
  const r = await mod.boot({ noOpen: true, quiet: true });
  return r;
}

/* ---------------- 窗口 ---------------- */

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: APP_TITLE,
    icon: path.join(__dirname, '..', 'app.ico'),
    backgroundColor: '#f1eee8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 本地页面，允许直接访问本机接口
      webSecurity: false
    }
  });

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isPortable) mainWindow.setMenuBarVisibility(false);
  });

  // 启动自检：preload 桥没生效的话打印会退回浏览器方式，这里留个记录
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript('!!(window.tikuElectron && window.tikuElectron.isDesktop)')
      .then((ok) => {
        console.log('[桌面版] 窗口已加载' + (ok ? '，打印桥正常' : '，警告：打印桥没生效'));
      })
      .catch(() => {});
  });

  // 外部链接一律用系统浏览器打开，别在应用里跳走
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打印当前试卷',
          accelerator: 'CmdOrCtrl+P',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-print'); }
        },
        { type: 'separator' },
        {
          label: '打开数据目录',
          click: () => { shell.openPath(process.env.TIKU_DATA); }
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        { label: '开发者工具', role: 'toggleDevTools' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: APP_TITLE + ' · 桌面版',
              detail: '版本 ' + app.getVersion() + '\n数据目录：' + process.env.TIKU_DATA +
                '\n\n除了把图片和文字发给大模型，其余数据全部留在本机。'
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- 打印桥 ---------------- */
// 浏览器里 window.print() 在 Electron 里不一定弹系统打印框，
// 统一走这里：渲染进程 → preload → 主进程 → webContents.print()

ipcMain.handle('tiku-print', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, message: '窗口不在了' };
  return new Promise((resolve) => {
    win.webContents.print(
      { silent: false, printBackground: true, margins: { marginType: 'none' } },
      (success, reason) => {
        if (!success && reason && reason !== 'cancelled') {
          resolve({ ok: false, message: reason });
        } else {
          resolve({ ok: true });
        }
      }
    );
  });
});

ipcMain.handle('tiku-print-pdf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  const r = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  return { ok: true, base64: r.toString('base64') };
});

ipcMain.handle('tiku-save-file', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const r = await dialog.showSaveDialog(win, {
    title: (opts && opts.title) || '保存',
    defaultPath: (opts && opts.defaultPath) || '未命名',
    filters: (opts && opts.filters) || []
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const data = Buffer.from((opts && opts.base64) || '', 'base64');
  fs.writeFileSync(r.filePath, data);
  return { ok: true, path: r.filePath };
});

ipcMain.handle('tiku-data-dir', () => process.env.TIKU_DATA);

ipcMain.handle('tiku-open-data-dir', async () => {
  const r = await shell.openPath(process.env.TIKU_DATA);
  if (r) throw new Error(r);
  return true;
});

/* ---------------- 调试钩子（只在设了环境变量时才生效） ---------------- */
// TIKU_SHOT=路径   启动 3 秒后把窗口截图存下来
// TIKU_PDF=路径    启动 4 秒后按 A4 导出打印 PDF（用来核对打印版式）
// TIKU_EVAL=路径   启动 2 秒后在页面里执行这个 JS 文件（用来驱动界面做验证）
function runDebugHooks(win) {
  if (process.env.TIKU_EVAL) {
    setTimeout(async () => {
      try {
        const code = fs.readFileSync(process.env.TIKU_EVAL, 'utf8');
        const r = await win.webContents.executeJavaScript(code, true);
        console.log('[调试] 页面脚本执行结果：' + JSON.stringify(r));
      } catch (e) { console.error('[调试] 页面脚本执行失败：' + e.message); }
    }, 2000);
  }
  if (process.env.TIKU_SHOT) {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.TIKU_SHOT, img.toPNG());
        console.log('[调试] 窗口截图已保存：' + process.env.TIKU_SHOT);
      } catch (e) { console.error('[调试] 截图失败：' + e.message); }
    }, 3000);
  }
  if (process.env.TIKU_PDF) {
    setTimeout(async () => {
      try {
        const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
        fs.writeFileSync(process.env.TIKU_PDF, pdf);
        console.log('[调试] 打印 PDF 已导出：' + process.env.TIKU_PDF);
      } catch (e) { console.error('[调试] 导出 PDF 失败：' + e.message); }
    }, 4000);
  }
}

/* ---------------- 启动 ---------------- */

app.whenReady().then(async () => {
  buildMenu();
  try {
    const r = await startBackend();
    if (r.status !== 'started' || !r.url) {
      // 已经有别的实例在跑同一个数据目录：提示一下，别开第二个窗口
      dialog.showMessageBox({
        type: 'info',
        title: APP_TITLE,
        message: '程序已经在运行了',
        detail: '同一个数据目录只能开一个实例，以免两边同时写数据。\n如果没看到窗口，请到任务栏里找一下。'
      });
      app.quit();
      return;
    }
    createWindow(r.url);
    runDebugHooks(mainWindow);
  } catch (e) {
    dialog.showErrorBox('启动失败', String((e && e.message) || e));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // macOS：点 Dock 图标重新开窗口
      startBackend().then((r) => { if (r.url) createWindow(r.url); });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    const store = require('../lib/db');
    store.flushNow();
    store.releaseLock();
  } catch (e) { /* 退出时尽量保存，失败就算了 */ }
});
