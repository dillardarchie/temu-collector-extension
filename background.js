/**
 * background.js - Temu批量采集助手 后台Service Worker
 * 功能：标签页管理、脚本注入、消息通信中枢、状态管理
 */

// ============================================================
// 常量与状态
// ============================================================

// Temu域名匹配
const TEMU_URL_PATTERNS = [
  'https://www.temu.com/*',
  'https://temu.com/*',
  'https://www.temu.co/*',
  'https://temu.co/*',
];

// 全局状态
const state = {
  collecting: false,        // 是否正在采集中
  collectedTabs: new Set(), // 已成功采集的标签页ID
  failedTabs: new Map(),    // 采集失败的标签页 { tabId: reason }
  totalTabs: 0,             // 本批次总标签页数
  processedTabs: 0,         // 已处理的标签页数
  config: {
    concurrency: 10,  // 默认并发数
    interval: 300,    // 默认采集间隔（ms）
  },
};

// ============================================================
// 工具函数
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断URL是否是Temu商品页面
 */
function isTemuProductPage(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes('temu.com') || hostname.includes('temu.co');
  } catch {
    return false;
  }
}

/**
 * 获取当前窗口所有Temu标签页
 */
async function getTemuTabs() {
  const currentWindow = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: currentWindow.id });
  return tabs.filter(
    (tab) => isTemuProductPage(tab.url) && !state.collectedTabs.has(tab.id)
  );
}

/**
 * 向popup推送状态更新
 */
function broadcastStatus() {
  const status = {
    collecting: state.collecting,
    total: state.totalTabs,
    processed: state.processedTabs,
    successCount: state.collectedTabs.size,
    failedCount: state.failedTabs.size,
    failedTabs: Object.fromEntries(state.failedTabs),
  };
  chrome.runtime.sendMessage({ action: 'statusUpdate', status }).catch(() => {
    // popup可能未打开，忽略错误
  });
}

/**
 * 加载保存的配置
 */
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get('config');
    if (result.config) {
      state.config = { ...state.config, ...result.config };
    }
  } catch (e) {
    console.error('[Temu采集助手] 加载配置失败:', e);
  }
}

/**
 * 保存配置
 */
async function saveConfig(config) {
  state.config = { ...state.config, ...config };
  try {
    await chrome.storage.local.set({ config: state.config });
  } catch (e) {
    console.error('[Temu采集助手] 保存配置失败:', e);
  }
}

// ============================================================
// 核心采集逻辑
// ============================================================

/**
 * 执行批量采集
 */
async function batchCollect() {
  if (state.collecting) {
    return { success: false, message: '正在采集中，请等待完成' };
  }

  // 重置状态
  state.collecting = true;
  state.failedTabs.clear();
  state.processedTabs = 0;
  broadcastStatus();

  // 获取Temu标签页
  const tabs = await getTemuTabs();
  
  if (tabs.length === 0) {
    state.collecting = false;
    broadcastStatus();
    return { success: false, message: '没有找到Temu商品标签页' };
  }

  // 限制并发数量
  const concurrency = Math.min(state.config.concurrency, tabs.length);
  const tabsToProcess = tabs.slice(0, concurrency);
  state.totalTabs = tabsToProcess.length;
  broadcastStatus();

  console.log(
    `[Temu采集助手] 开始批量采集，共${tabsToProcess.length}个标签页`
  );

  // 逐个标签页注入脚本并采集
  for (let i = 0; i < tabsToProcess.length; i++) {
    const tab = tabsToProcess[i];

    try {
      // 先尝试直接发消息（content script可能已注入）
      let response = null;
      try {
        response = await chrome.tabs.sendMessage(tab.id, {
          action: 'collect',
        });
      } catch (e) {
        // content script 未注入，需要先注入
      }

      // 如果没有响应，注入 content script 后再发送消息
      if (!response) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });

        // 等待 content script 初始化
        await sleep(200);

        response = await chrome.tabs.sendMessage(tab.id, {
          action: 'collect',
        });
      }

      if (response && response.success) {
        state.collectedTabs.add(tab.id);
        console.log(
          `[Temu采集助手] 标签页 ${tab.id} 采集成功: ${response.message}`
        );
      } else {
        state.failedTabs.set(
          tab.id,
          response ? response.message : '无响应'
        );
        console.warn(
          `[Temu采集助手] 标签页 ${tab.id} 采集失败: ${response?.message}`
        );
      }
    } catch (error) {
      state.failedTabs.set(tab.id, `注入脚本失败: ${error.message}`);
      console.error(
        `[Temu采集助手] 标签页 ${tab.id} 执行失败:`,
        error
      );
    }

    state.processedTabs = i + 1;
    broadcastStatus();

    // 标签页之间间隔，避免过快
    if (i < tabsToProcess.length - 1) {
      await sleep(state.config.interval);
    }
  }

  state.collecting = false;
  broadcastStatus();

  const summary = {
    success: true,
    total: state.totalTabs,
    successCount: state.collectedTabs.size,
    failedCount: state.failedTabs.size,
    message: `采集完成：成功${state.collectedTabs.size}个，失败${state.failedTabs.size}个`,
  };

  console.log('[Temu采集助手]', summary.message);
  return summary;
}

/**
 * 关闭已采集的标签页
 */
async function closeCollectedTabs() {
  const tabIds = Array.from(state.collectedTabs);
  if (tabIds.length === 0) {
    return { success: false, message: '没有已采集的标签页可关闭' };
  }

  try {
    await chrome.tabs.remove(tabIds);
    state.collectedTabs.clear();
    broadcastStatus();
    return {
      success: true,
      message: `已关闭${tabIds.length}个标签页`,
    };
  } catch (error) {
    return {
      success: false,
      message: `关闭标签页失败: ${error.message}`,
    };
  }
}

/**
 * 重新采集失败项
 */
async function retryFailed() {
  if (state.collecting) {
    return { success: false, message: '正在采集中，请等待完成' };
  }

  const failedTabIds = Array.from(state.failedTabs.keys());
  if (failedTabIds.length === 0) {
    return { success: false, message: '没有失败项可重试' };
  }

  // 清除失败记录
  state.failedTabs.clear();
  state.collecting = true;
  state.processedTabs = 0;
  state.totalTabs = failedTabIds.length;
  broadcastStatus();

  for (let i = 0; i < failedTabIds.length; i++) {
    const tabId = failedTabIds[i];

    try {
      // 先尝试直接发消息
      let response = null;
      try {
        response = await chrome.tabs.sendMessage(tabId, {
          action: 'collect',
        });
      } catch (e) {
        // 未注入，先注入
      }

      if (!response) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        await sleep(200);
        response = await chrome.tabs.sendMessage(tabId, {
          action: 'collect',
        });
      }

      if (response && response.success) {
        state.collectedTabs.add(tabId);
      } else {
        state.failedTabs.set(
          tabId,
          response ? response.message : '无响应'
        );
      }
    } catch (error) {
      state.failedTabs.set(tabId, `重试失败: ${error.message}`);
    }

    state.processedTabs = i + 1;
    broadcastStatus();

    if (i < failedTabIds.length - 1) {
      await sleep(state.config.interval);
    }
  }

  state.collecting = false;
  broadcastStatus();

  return {
    success: true,
    message: `重试完成：成功${state.collectedTabs.size}个，仍有${state.failedTabs.size}个失败`,
  };
}

// ============================================================
// 消息监听 — 接收来自 popup 的指令
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'startCollect':
      batchCollect().then(sendResponse);
      return true; // 异步响应

    case 'closeCollected':
      closeCollectedTabs().then(sendResponse);
      return true;

    case 'retryFailed':
      retryFailed().then(sendResponse);
      return true;

    case 'getStatus':
      sendResponse({
        collecting: state.collecting,
        total: state.totalTabs,
        processed: state.processedTabs,
        successCount: state.collectedTabs.size,
        failedCount: state.failedTabs.size,
        failedTabs: Object.fromEntries(state.failedTabs),
      });
      return false;

    case 'getConfig':
      sendResponse(state.config);
      return false;

    case 'saveConfig':
      saveConfig(message.config).then(() => sendResponse({ success: true }));
      return true;

    case 'getTemuTabCount':
      getTemuTabs().then((tabs) =>
        sendResponse({ count: tabs.length })
      );
      return true;

    case 'debug':
      // 获取当前活动的标签页并发送debug指令
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs.length === 0) {
          sendResponse({ found: false, message: '无法获取当前标签页' });
          return;
        }
        const tab = tabs[0];
        if (!isTemuProductPage(tab.url)) {
          sendResponse({ found: false, message: '当前页面不是Temu商品页' });
          return;
        }
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'debug' });
          sendResponse(response);
        } catch (e) {
          // content script未注入，尝试注入后再发送
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js'],
            });
            await sleep(200);
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'debug' });
            sendResponse(response);
          } catch (err) {
            sendResponse({ found: false, message: `注入失败: ${err.message}` });
          }
        }
      });
      return true;

    default:
      sendResponse({ success: false, message: '未知指令' });
      return false;
  }
});

// ============================================================
// 快捷键监听
// ============================================================

chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'batch-collect':
      if (!state.collecting) {
        batchCollect();
      }
      break;
    case 'close-collected':
      if (!state.collecting) {
        closeCollectedTabs();
      }
      break;
  }
});

// ============================================================
// 初始化
// ============================================================

loadConfig();
console.log('[Temu采集助手] Background service worker 已启动');
