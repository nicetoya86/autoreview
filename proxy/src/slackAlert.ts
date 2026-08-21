/**
 * SLACK_WEBHOOK_URL이 설정된 경우에만 Slack Incoming Webhook으로 알림을 보낸다.
 * 알림 전송 실패가 실제 응답(검수 결과)에 영향을 주면 안 되므로 예외를 던지지 않는다.
 */
export async function sendSlackAlert(webhookUrl: string | undefined, text: string): Promise<void> {
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error('[slack-alert] 전송 실패:', err);
  }
}
