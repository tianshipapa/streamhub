
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// 屏蔽安全警告
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'StreamHub Vision',
    // CommonJS 中可以直接使用 __dirname
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // 核心配置：禁用同源策略，允许直接请求任何视频流
      webSecurity: false, 
      // 允许运行不安全的内容（混合内容）
      allowRunningInsecureContent: true,
    },
    // 隐藏默认菜单栏
    autoHideMenuBar: true, 
  });

  // 处理新窗口打开链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 开发环境加载本地服务，生产环境加载打包后的文件
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // 生产环境下路径指向 dist/index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
