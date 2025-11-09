// 공개 가능한 환경변수만 제공
export async function handler(event, context) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      googleCalendarApiKey: process.env.GOOGLE_CALENDAR_API_KEY
    })
  };
}
