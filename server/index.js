import dotenv from 'dotenv';
import path from 'node:path';
import { configFromEnv, projectRoot } from './config.js';
import { Store } from './store.js';
import { Vault, TeslaAuth } from './vault.js';
import { Poller } from './poller.js';
import { createApp } from './app.js';

dotenv.config({path:process.env.DOTENV_CONFIG_PATH||path.join(process.env.QUAGOEV_DATA_DIR||path.join(projectRoot,'data-v2'),'server.env')});
const config=configFromEnv();
const store=new Store(config.dataDir,config);
if(config.mode==='telemetry'&&(!config.billingVerified||!config.telemetrySourceBudgetVerified)) store.status('paused','Telemetry requires verified Tesla billing and source-side budget protection.');
const vault=new Vault(config.dataDir,config.vaultKey);
const auth=new TeslaAuth(config,vault);
const poller=new Poller(config,store,auth);
const app=createApp({config,store,auth});
const server=app.listen(config.port,config.host,()=>{
  console.log(`QuagoEV data server listening on ${config.host}:${config.port}; collector: ${config.mode}`);
  poller.start();
});
let stopping=false;
function stop(){if(stopping)return;stopping=true;poller.stop();server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
