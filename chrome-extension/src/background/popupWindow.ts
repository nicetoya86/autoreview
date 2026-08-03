export interface WindowsApi {
  create(opts: { url: string; type: 'popup'; width: number; height: number }): Promise<{ id?: number }>;
  update(windowId: number, opts: { focused: boolean }): Promise<unknown>;
}

/**
 * action.onClicked로 열리는 요약 창을 관리한다. 팝업 대신 일반 창으로 열어야
 * 바깥 클릭에도 닫히지 않는다(액션 팝업은 포커스를 잃으면 브라우저가 강제로 닫음).
 */
export function createPopupWindowController(windowsApi: WindowsApi, popupUrl: string) {
  let popupWindowId: number | undefined;

  return {
    async openOrFocus() {
      if (popupWindowId !== undefined) {
        try {
          await windowsApi.update(popupWindowId, { focused: true });
          return;
        } catch {
          popupWindowId = undefined;
        }
      }
      const win = await windowsApi.create({ url: popupUrl, type: 'popup', width: 340, height: 480 });
      popupWindowId = win.id;
    },

    handleClosed(windowId: number) {
      if (popupWindowId === windowId) popupWindowId = undefined;
    },
  };
}
