import { describe, it, expect, vi } from 'vitest';
import { createPopupWindowController } from '../src/background/popupWindow';

function fakeWindowsApi() {
  let nextId = 1;
  return {
    create: vi.fn(async () => ({ id: nextId++ })),
    update: vi.fn(async () => ({})),
  };
}

describe('createPopupWindowController', () => {
  it('처음 열 때는 create를 호출한다', async () => {
    const windowsApi = fakeWindowsApi();
    const controller = createPopupWindowController(windowsApi, 'url');

    await controller.openOrFocus();

    expect(windowsApi.create).toHaveBeenCalledTimes(1);
    expect(windowsApi.update).not.toHaveBeenCalled();
  });

  it('이미 열려 있으면 create 대신 focus만 한다', async () => {
    const windowsApi = fakeWindowsApi();
    const controller = createPopupWindowController(windowsApi, 'url');

    await controller.openOrFocus();
    await controller.openOrFocus();

    expect(windowsApi.create).toHaveBeenCalledTimes(1);
    expect(windowsApi.update).toHaveBeenCalledTimes(1);
  });

  it('사용자가 창을 닫은 뒤 다시 열면 create를 다시 호출한다', async () => {
    const windowsApi = fakeWindowsApi();
    const controller = createPopupWindowController(windowsApi, 'url');

    await controller.openOrFocus();
    controller.handleClosed(1);
    await controller.openOrFocus();

    expect(windowsApi.create).toHaveBeenCalledTimes(2);
  });

  it('update가 실패하면(창이 이미 사라짐) create로 대체한다', async () => {
    const windowsApi = fakeWindowsApi();
    windowsApi.update.mockRejectedValueOnce(new Error('no such window'));
    const controller = createPopupWindowController(windowsApi, 'url');

    await controller.openOrFocus();
    await controller.openOrFocus();

    expect(windowsApi.create).toHaveBeenCalledTimes(2);
  });
});
