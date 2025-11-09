// 관리자 비밀번호 검증 (서버에서만 실행)
exports.handler = async (event, context) => {
  // CORS 프리플라이트 처리
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { password } = JSON.parse(event.body);
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: '관리자 비밀번호가 설정되지 않았습니다',
          valid: false 
        })
      };
    }

    const isValid = password === adminPassword;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ valid: isValid })
    };

  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: '잘못된 요청입니다',
        valid: false 
      })
    };
  }
};
