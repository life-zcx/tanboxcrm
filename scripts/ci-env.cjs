const fs=require('fs'),path=require('path'),{randomBytes}=require('crypto');
const root=path.resolve(__dirname,'..');
if(fs.existsSync(path.join(root,'.env')))throw new Error('Refusing to overwrite existing configuration');
const password=randomBytes(32).toString('hex'),secret=randomBytes(48).toString('hex');
const shared='POSTGRES_PASSWORD='+password+'\nJWT_SECRET='+secret+'\nTELEGRAM_ALLOWED_USER_IDS=8563274673\nAPP_ORIGIN=http://127.0.0.1:3050\nTELEGRAM_BOT_TOKEN=\nGOOGLE_GEMINI_API_KEY=\nOPENAI_API_KEY=\nKNOWLEDGE_AUTO_COLLECT=false\n';
fs.writeFileSync(path.join(root,'.env'),shared);
fs.writeFileSync(path.join(root,'backend/.env'),shared+'DATABASE_URL=postgresql://tanbox_crm:'+password+'@127.0.0.1:5434/tanbox_crm?schema=public\nTELEGRAM_POLLING=false\n');
