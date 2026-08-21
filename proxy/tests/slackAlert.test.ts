import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendSlackAlert } from '../src/slackAlert';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendSlackAlert', () => {
  it('webhookUrl이 없으면 fetch를 호출하지 않는다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await sendSlackAlert(undefined, '테스트 메시지');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('webhookUrl이 있으면 해당 URL로 text를 담아 POST한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as unknown as Response);

    await sendSlackAlert('https://hooks.slack.com/services/xxx', '테스트 메시지');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/xxx',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '테스트 메시지' }),
      })
    );
  });

  it('fetch가 실패해도 예외를 던지지 않는다', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(sendSlackAlert('https://hooks.slack.com/services/xxx', '테스트 메시지')).resolves.toBeUndefined();
  });
});
