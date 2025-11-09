// 환경 변수 테스트
export async function handler(event, context) {
  try {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    
    const result = {
      hasEnvVar: !!serviceAccountJson,
      length: serviceAccountJson?.length,
      first100: serviceAccountJson?.substring(0, 100),
      last50: serviceAccountJson?.substring(serviceAccountJson?.length - 50),
    };

    if (serviceAccountJson) {
      try {
        const parsed = JSON.parse(serviceAccountJson);
        result.parsed = {
          keys: Object.keys(parsed),
          hasClientEmail: !!parsed.client_email,
          clientEmail: parsed.client_email,
          hasPrivateKey: !!parsed.private_key,
          privateKeyLength: parsed.private_key?.length,
          privateKeyStart: parsed.private_key?.substring(0, 50),
        };
      } catch (e) {
        result.parseError = e.message;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result, null, 2)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
