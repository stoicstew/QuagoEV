import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { projectRoot } from './config.js';
import { importData } from './import.js';
import { ingestObservation } from './observations.js';

function sameSecret(input,expected) {
  if(typeof input!=='string'||!expected) return false;
  const a=crypto.createHash('sha256').update(input).digest(),b=crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a,b);
}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

export function createApp({config,store,auth}) {
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');
    const origin=req.headers.origin;
    const allowed=['quagoev://app','http://localhost:4200','http://127.0.0.1:4200'];
    if(origin&&allowed.includes(origin)) {
      res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');
      res.set('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
    }
    if(req.method==='OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({limit:'32mb'}));
  const authorised=(req,res,next)=>{
    const header=req.headers.authorization||'';
    if(!header.startsWith('Bearer ')||!sameSecret(header.slice(7),config.accessToken)) return res.status(401).json({error:'Enter the QuagoEV server access key.'});
    res.set('Cache-Control','no-store');next();
  };
  app.get('/healthz',(_req,res)=>res.json({status:'ok',schemaVersion:2}));
  app.use('/api',authorised);
  app.get('/api/v2/snapshot',(_req,res)=>res.json(store.snapshot()));
  app.patch('/api/v2/settings',(req,res,next)=>{try{store.editSettings(req.body);res.json(store.snapshot());}catch(e){next(e);}});
  app.patch('/api/v2/trips/:id',(req,res,next)=>{try{store.editRecord('trips',req.params.id,req.body);res.json(store.snapshot());}catch(e){next(e);}});
  app.patch('/api/v2/charges/:id',(req,res,next)=>{try{store.editRecord('charges',req.params.id,req.body);res.json(store.snapshot());}catch(e){next(e);}});
  app.get('/api/v2/export',(_req,res)=>res.attachment(`quagoev-${new Date().toISOString().slice(0,10)}.json`).json(store.backup()));
  app.post('/api/v2/import',(req,res,next)=>{try{importData(store,req.body?.format,req.body?.data);res.json(store.snapshot());}catch(e){next(e);}});
  app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown endpoint. QuagoEV provides data only.'}));
  app.get('/auth/status',authorised,(_req,res)=>res.json({authenticated:auth.ready(),configured:!!(config.clientId&&config.clientSecret&&config.redirectUri),collectorMode:config.mode}));
  app.get('/auth/login',authorised,(req,res,next)=>{try{res.json({url:auth.loginUrl()});}catch(error){error.status=400;next(error);}});
  const callback=wrap(async(req,res)=>{
    res.set('Cache-Control','no-store');
    await auth.callback(req.query.code,req.query.state);
    res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>QuagoEV connected</title><main><h1>Tesla connected</h1><p>You can close this window and return to QuagoEV. Collection follows the server configuration.</p></main>');
  });
  app.get('/auth/callback',callback);app.get('/callback',callback);
  app.post('/internal/observations',(req,res,next)=>{
    try {
      if(config.mode!=='telemetry'||!config.billingVerified||!config.telemetrySourceBudgetVerified) return res.status(409).json({error:'Telemetry requires verified source-side budget protection before activation.'});
      if(!sameSecret((req.headers.authorization||'').replace(/^Bearer /,''),config.telemetryToken)) return res.status(401).json({error:'Invalid receiver credential.'});
      const signals=Number(req.body?.signals);
      if(!Number.isSafeInteger(signals)||signals<0||signals>1000) return res.status(400).json({error:'Invalid signal count'});
      // Rejecting data here does NOT stop the vehicle's billable stream. Actual
      // source-side shutdown must be verified before production telemetry use.
      const event=req.body.observation;
      if(!event||typeof event.eventId!=='string') return res.status(400).json({error:'Missing observation'});
      if(store.db.prepare('SELECT event_id FROM received WHERE event_id=?').get(event.eventId)) return res.json({accepted:false,duplicate:true});
      if(!store.reserveUsage({signals})) {store.status('budget_paused','Telemetry budget estimate reached. Disable the vehicle stream at its source.');return res.status(429).json({error:'Telemetry budget reached; stop the source stream.'});}
      const accepted=ingestObservation(store,event);
      store.status('collecting','Receiving vehicle telemetry.',Date.now());res.json({accepted});
    }catch(e){next(e);}
  });
  app.use('/internal',(_req,res)=>res.status(404).json({error:'Unknown receiver endpoint'}));
  const dist=path.join(projectRoot,'dist');
  if(fs.existsSync(dist)) {
    app.use(express.static(dist,{index:false}));
    app.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
  }
  app.use((error,_req,res,_next)=>{
    const status=error.status||400;
    res.status(status>=400&&status<600?status:500).json({error:status===500?'Server error. Check the server log.':error.message||'Invalid request'});
  });
  return app;
}
