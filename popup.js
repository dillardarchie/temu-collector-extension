/**
 * popup.js - Temu批量采集助手 弹窗逻辑
 * 功能：用户操作、进度显示、消息通信
 */

(function () {
  'use strict';

  // ============================================================
  // DOM 元素引用
  // ============================================================

  const elements = {
    tabCount: document.getElementById('tabCount'),
    concurrency: document.getElementById('concurrency'),
    concurrencyValue: document.getElementById('concurrencyValue'),
    interval: document.getElementById('interval'),
    intervalValue: document.getElementById('intervalValue'),
    collectBtn: document.getElementById('collectBtn'),
    progressArea: document.getElementById('progressArea'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    successCount: document.getElementById('successCount'),
    failCount: document.getElementById('failCount'),
    resultSection: document.getElementById('resultSection'),
    closeCollectedBtn: document.getElementById('closeCollectedBtn'),
    retryFailedBtn: document.getElementById('retryFailedBtn'),
    debugBtn: document.getElementById('debugBtn'),
    debugResult: document.getElementById('debugResult'),
    debugContent: document.getElementById('debugContent'),
    toast: document.getElementById('toast'),
  };

  // ============================================================
  // 状态
  // ============================================================

  let isCollecting = false;

  // ============================================================
  // 工具函数
  // ============================================================

  /**
   * 显示 Toast 通知
   */
  function showToast(message, type = 'info', duration = 2500) {
    const toast = elements.toast;
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.className = 'toast';
    }, duration);
  }

  /**
   * 发送消息给 background.js
   */
  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });
  }

  // ============================================================
  // 初始化
  // ============================================================

  async function init() {
    // 加载配置
    const config = await sendMessage({ action: 'getConfig' });
    if (config) {
      elements.concurrency.value = config.concurrency || 10;
      elements.concurrencyValue.textContent = config.concurrency || 10;
      elements.interval.value = config.interval || 300;
      elements.intervalValue.textContent = `${config.interval || 300}ms`;
    }

    // 检测Temu标签页数量
    await updateTabCount();

    // 获取当前状态
    const status = await sendMessage({ action: 'getStatus' });
    if (status) {
      updateProgressUI(status);
      if (status.collecting) {
        setCollectingState(true);
      }
      if (status.successCount > 0 || status.failedCount > 0) {
        showResultSection(status);
      }
    }
  }

  /**
   * 更新Temu标签页数量
   */
  async function updateTabCount() {
    const result = await sendMessage({ action: 'getTemuTabCount' });
    if (result) {
      elements.tabCount.textContent = result.count;
    }
  }

  // ============================================================
  // 配置滑块事件
  // ============================================================

  elements.concurrency.addEventListener('input', (e) => {
    const value = parseInt(e.target.value, 10);
    elements.concurrencyValue.textContent = value;
    sendMessage({
      action: 'saveConfig',
      config: { concurrency: value },
    });
  });

  elements.interval.addEventListener('input', (e) => {
    const value = parseInt(e.target.value, 10);
    elements.intervalValue.textContent = `${value}ms`;
    sendMessage({
      action: 'saveConfig',
      config: { interval: value },
    });
  });

  // ============================================================
  // 采集按钮事件
  // ============================================================

  elements.collectBtn.addEventListener('click', async () => {
    if (isCollecting) return;

    setCollectingState(true);
    elements.progressArea.style.display = 'block';

    const result = await sendMessage({ action: 'startCollect' });

    if (result) {
      if (result.success) {
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
        setCollectingState(false);
      }
    }

    await updateTabCount();
  });

  /**
   * 设置采集中状态
   */
  function setCollectingState(collecting) {
    isCollecting = collecting;
    const btn = elements.collectBtn;

    if (collecting) {
      btn.disabled = true;
      btn.querySelector('.btn-icon').textContent = '⏳';
      btn.querySelector('.btn-text').textContent = '采集中...';
      btn.classList.add('collecting');
    } else {
      btn.disabled = false;
      btn.querySelector('.btn-icon').textContent = '🚀';
      btn.querySelector('.btn-text').textContent = '开始采集';
      btn.classList.remove('collecting');
    }
  }

  // ============================================================
  // 进度更新
  // ============================================================

  function updateProgressUI(status) {
    const { total, processed, successCount, failedCount } = status;
    const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

    elements.progressBar.style.width = `${progress}%`;
    elements.progressText.textContent = `${processed}/${total}`;
    elements.successCount.textContent = successCount;
    elements.failCount.textContent = failedCount;

    // 采集完成
    if (processed >= total && total > 0 && !status.collecting) {
      setCollectingState(false);
      elements.collectBtn.querySelector('.btn-icon').textContent = '✅';
      elements.collectBtn.querySelector('.btn-text').textContent = '采集完成';
      showResultSection(status);
    }
  }

  /**
   * 显示结果操作区
   */
  function showResultSection(status) {
    elements.resultSection.style.display = 'block';

    if (status.failedCount > 0) {
      elements.retryFailedBtn.style.display = 'flex';
    } else {
      elements.retryFailedBtn.style.display = 'none';
    }

    if (status.successCount > 0) {
      elements.closeCollectedBtn.style.display = 'flex';
    }
  }

  // ============================================================
  // 结果操作按钮事件
  // ============================================================

  elements.closeCollectedBtn.addEventListener('click', async () => {
    const result = await sendMessage({ action: 'closeCollected' });
    if (result && result.success) {
      showToast(result.message, 'success');
      elements.closeCollectedBtn.style.display = 'none';
      // 重置UI
      setTimeout(() => {
        elements.progressArea.style.display = 'none';
        elements.resultSection.style.display = 'none';
        elements.collectBtn.querySelector('.btn-icon').textContent = '🚀';
        elements.collectBtn.querySelector('.btn-text').textContent = '开始采集';
        updateTabCount();
      }, 1000);
    } else if (result) {
      showToast(result.message, 'error');
    }
  });

  elements.retryFailedBtn.addEventListener('click', async () => {
    setCollectingState(true);
    elements.retryFailedBtn.style.display = 'none';

    const result = await sendMessage({ action: 'retryFailed' });
    if (result) {
      showToast(result.message, result.success ? 'success' : 'error');
    }
  });

  // ============================================================
  // 监听 background 状态推送
  // ============================================================

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'statusUpdate') {
      updateProgressUI(message.status);
    }
  });

  // ============================================================
  // 调试按钮事件
  // ============================================================

  elements.debugBtn.addEventListener('click', async () => {
    elements.debugResult.style.display = 'block';
    elements.debugContent.innerHTML = '⏳ 正在检测...';

    const result = await sendMessage({ action: 'debug' });

    if (result && result.found) {
      elements.debugContent.innerHTML = `<span class="found">✅ 找到按钮！</span><br>文字内容: "${result.text}"`;
    } else {
      elements.debugContent.innerHTML = `<span class="not-found">❌ 未找到采集按钮</span><br>可能原因：<br>1. 妙手插件未安装或未登录<br>2. 页面不是Temu商品详情页<br>3. 按钮加载较慢，请稍后重试`;
    }
  });

  // ============================================================
  // 启动
  // ============================================================

  init();
})();
