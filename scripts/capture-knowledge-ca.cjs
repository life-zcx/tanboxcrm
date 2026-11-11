// Run with Node --use-system-ca. Export only the public issuer chain of an
// HTTPS connection already verified against the operating system trust store.
const https=require('node:https');const fs=require('node:fs');
https.get('https://zan.gov.kz/api/documents/225827/rus/download/pdf',res=>{
 if(!res.socket.authorized)throw Error('Unverified TLS connection');
 const seen=new Set(),certificates=[];let cert=res.socket.getPeerCertificate(true).issuerCertificate;
 while(cert?.raw&&!seen.has(cert.fingerprint256)){
  seen.add(cert.fingerprint256);certificates.push('-----BEGIN CERTIFICATE-----\n'+cert.raw.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n');
  console.log(JSON.stringify({subject:cert.subject,issuer:cert.issuer,fingerprint256:cert.fingerprint256}));cert=cert.issuerCertificate;
 }
 if(!certificates.length)throw Error('Issuer chain missing');
 fs.writeFileSync('backend/data/knowledge-ca.pem',certificates.join('\n'));res.resume();
}).on('error',error=>{console.error(error.message);process.exitCode=1;});
