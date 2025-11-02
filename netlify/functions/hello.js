// 최소한의 테스트 함수 - import도 없음
export async function handler(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from Netlify Functions!',
      timestamp: new Date().toISOString(),
      method: event.httpMethod
    })
  };
}
