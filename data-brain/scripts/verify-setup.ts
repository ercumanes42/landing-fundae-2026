import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Standalone setup helper to check environment keys and db connection
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

// Manual dotenv parser to avoid dependency issues in standalone execution
function loadEnv() {
  if (!fs.existsSync(envPath)) {
    console.warn(`[db:verify] Warning: No .env file found at ${envPath}. Checking system environment variables.`);
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    // remove quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  });
}

async function verify() {
  console.log('----------------------------------------------------');
  console.log('🔍 INICIANDO AUDITORÍA DE CONFIGURACIÓN DATA BRAIN');
  console.log('----------------------------------------------------');

  loadEnv();

  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LEAD_HASH_SECRET',
    'OPENAI_API_KEY',
    'DATA_BRAIN_ADMIN_USER',
    'DATA_BRAIN_ADMIN_PASSWORD',
  ];

  let missing = 0;
  for (const envKey of required) {
    const val = process.env[envKey];
    if (!val) {
      console.log(`❌ Variable Faltante: ${envKey}`);
      missing++;
    } else {
      const displayVal = envKey.includes('KEY') || envKey.includes('SECRET') || envKey.includes('PASSWORD')
        ? `${val.slice(0, 8)}... (Ocultado)`
        : val;
      console.log(`✓ Variable Cargada: ${envKey} = ${displayVal}`);
    }
  }

  if (missing > 0) {
    console.log(`\n❌ Error: Faltan ${missing} variables esenciales en tu .env.`);
    process.exit(1);
  }

  console.log('\n📡 Probando conexión con Supabase...');
  try {
    const sbUrl = `${process.env.SUPABASE_URL!.replace(/\/+$/, '')}/rest/v1/leads?select=id&limit=1`;
    const response = await fetch(sbUrl, {
      method: 'GET',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      console.log('✓ Conectividad Supabase exitosa.');
    } else {
      const text = await response.text();
      throw new Error(`Supabase devolvió código ${response.status}: ${text}`);
    }
  } catch (err) {
    console.log(`❌ Error al conectar con Supabase:`, err instanceof Error ? err.message : err);
    console.log('   Por favor verifica que la variable SUPABASE_URL sea correcta y la base de datos esté activa.');
    process.exit(1);
  }

  console.log('\n🧠 Probando clave de API OpenAI...');
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      },
    });

    if (response.ok) {
      console.log('✓ Clave OpenAI API verificada correctamente.');
    } else {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Código ${response.status}`);
    }
  } catch (err) {
    console.log(`❌ Error al validar OpenAI:`, err instanceof Error ? err.message : err);
    console.log('   Verifica que OPENAI_API_KEY sea correcta y tenga saldo disponible.');
    process.exit(1);
  }

  console.log('\n🔔 Opcional - Webhooks de alerta:');
  const slackUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (slackUrl) {
    console.log(`✓ NOTIFICATION_WEBHOOK_URL configurado (${slackUrl.slice(0, 15)}...)`);
  } else {
    console.log('ℹ NOTIFICATION_WEBHOOK_URL no configurado (Las alertas de leads prioritarios no se enviarán).');
  }

  console.log('----------------------------------------------------');
  console.log('🎉 AUDITORÍA DE DATA BRAIN COMPLETADA CON ÉXITO');
  console.log('   El sistema está listo para operar.');
  console.log('----------------------------------------------------');
}

verify().catch((err) => {
  console.error('Fallo inesperado durante la verificación:', err);
  process.exit(1);
});
