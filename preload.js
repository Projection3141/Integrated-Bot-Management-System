/**
 * preload.js
 *
 * =============================================================================
 * ELECTRON PRELOAD
 * =============================================================================
 *
 * 역할:
 *  - renderer에 필요한 최소 API만 안전하게 노출
 *  - 직접 ipcRenderer 전체를 노출하지 않음
 *
 * 노출 API:
 *  1) listBots()
 *  2) startBot(key)
 *  3) stopBot(key)
 *  4) onStatus(callback)
 *  5) onLog(callback)
 * =============================================================================
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("botAPI", {
  /** 현재 bot 상태 목록 조회 */
  listBots: () => ipcRenderer.invoke("bot:list"),

  /** 특정 bot 시작 */
  startBot: (key, options = {}) =>
    ipcRenderer.invoke("bot:start", key, options),

  /** 특정 bot 중지 */
  stopBot: (key) => ipcRenderer.invoke("bot:stop", key),

  /** 상태 변경 이벤트 구독 */
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("bot:status", handler);

    return () => {
      ipcRenderer.removeListener("bot:status", handler);
    };
  },

  /** 로그 이벤트 구독 */
  onLog: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("bot:log", handler);

    return () => {
      ipcRenderer.removeListener("bot:log", handler);
    };
  },

  /** 실행 이력 가져오기 */
  getHistory: () => ipcRenderer.invoke("bot:getHistory"),

  pickImageFile: () => ipcRenderer.invoke("dialog:pickImage"),

});