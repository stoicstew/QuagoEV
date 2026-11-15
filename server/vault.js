import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class Vault {
  constructor(dataDir, hexKey) { this.path = path.join(dataDir,'tesla-vault.json'); this.key = Buffer.from(hexKey,'hex'); }
  read() {
    if (!fs.existsSync(this.path)) return null;
    const file = JSON.parse(fs.readFileSync(this.path,'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm',this.key,Buffer.from(file.iv,'base64'));
    decipher.setAuthTag(Buffer.from(file.tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.data,'base64')),decipher.final()]).toString('utf8'));
  }
  write(tokens) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',this.key,iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(tokens)),cipher.final()]);
    const tmp = `${this.path}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});
    fs.renameSync(tmp,this.path);
  }
  clear() { if (fs.existsSync(this.path)) fs.unlinkSync(this.path); }
}

export class TeslaAuth {
  constructor(config,vault,fetchImpl=fetch) { this.config=config;this.vault=vault;this.fetch=fetchImpl;this.pending=null;this.states=new Map(); }
  ready() { return !!this.vault.read()?.refresh_token; }
  loginUrl() {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) throw new Error('Tesla OAuth is not configured on the server');
    const state=crypto.randomBytes(24).toString('base64url'), verifier=crypto.randomBytes(32).toString('base64url');
    for(const [key,v] of this.states) if(v.expires<Date.now()) this.states.delete(key);
    this.states.set(state,{verifier,expires:Date.now()+600000});
    const params = new URLSearchParams({response_type:'code',client_id:this.config.clientId,redirect_uri:this.config.redirectUri,scope:'openid offline_access vehicle_device_data vehicle_location',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return `https://auth.tesla.com/oauth2/v3/authorize?${params}`;
  }
  async exchange(fields) {
    const response=await this.fetch('https://auth.tesla.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,...fields}),signal:AbortSignal.timeout(20000)});
    if(!response.ok) { const error=new Error('Tesla authorization needs reconnecting');error.status=response.status;throw error; }
    const data=await response.json();
    if(typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)) throw new Error('Invalid Tesla authorization response');
    const result={access_token:data.access_token,refresh_token:data.refresh_token||fields.refresh_token,expires_at:Date.now()+data.expires_in*1000};
    this.vault.write(result);return result.access_token;
  }
  async callback(code,state) {
    const saved=this.states.get(state);this.states.delete(state);
    if(!saved||saved.expires<Date.now()||typeof code!=='string') throw new Error('Invalid or expired sign-in attempt');
    return this.exchange({grant_type:'authorization_code',code,redirect_uri:this.config.redirectUri,code_verifier:saved.verifier,audience:this.config.fleetApi});
  }
  async token() {
    const saved=this.vault.read();
    if(!saved?.refresh_token) throw new Error('Connect Tesla in server settings first');
    if(saved.expires_at>Date.now()+300000) return saved.access_token;
    if(!this.pending) this.pending=this.exchange({grant_type:'refresh_token',refresh_token:saved.refresh_token}).finally(()=>{this.pending=null;});
    return this.pending;
  }
}
