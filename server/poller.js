import { fromFleetData, ingestObservation } from './observations.js';

export class Poller {
  constructor(config,store,auth,fetchImpl=fetch) { this.config=config;this.store=store;this.auth=auth;this.fetch=fetchImpl;this.timer=null;this.running=false;this.stopped=true; }
  async read(path,token) {
    if(!/^\/api\/1\/vehicles(?:\/[^/]+\/vehicle_data\?.*)?$/.test(path)) throw new Error('Only vehicle data requests are allowed');
    // Count every attempt conservatively, including failed calls. Reserve BEFORE
    // making the request so failures and concurrent readers cannot bypass limits.
    if(!this.store.reserveUsage({requests:1})) { const error=new Error('Local monthly API budget reached. Collection is paused.');error.budget=true;throw error; }
    const response=await this.fetch(`${this.config.fleetApi}${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new Error(response.status===401?'Tesla sign-in needs renewing.':response.status===429?'Tesla rate limit reached; waiting before retry.':`Tesla data request failed (${response.status}).`);
    const result=await response.json();
    return result.response;
  }
  async poll() {
    if(this.running||this.config.mode!=='polling'||!this.config.billingVerified) return;
    this.running=true;
    try {
      if(!this.auth.ready()) {this.store.status('waiting_for_auth','Connect your Tesla account in server settings.');return;}
      const token=await this.auth.token();
      const vehicles=await this.read('/api/1/vehicles',token);
      if(!Array.isArray(vehicles)) throw new Error('Tesla returned an invalid vehicle list');
      const selected=this.config.vin?vehicles.filter(v=>v.vin===this.config.vin):vehicles;
      if(!selected.length) throw new Error('No authorised vehicle matches this server');
      for(const vehicle of selected) {
        let data=null;
        if(vehicle.state==='online') data=await this.read(`/api/1/vehicles/${encodeURIComponent(vehicle.vin||vehicle.id_s||vehicle.id)}/vehicle_data?endpoints=charge_state%3Bdrive_state%3Bvehicle_state%3Bvehicle_config%3Bclimate_state%3Blocation_data`,token);
        ingestObservation(this.store,fromFleetData(vehicle,data),{maxGapMs:this.config.pollSeconds*3000});
      }
      this.store.status('collecting','Polling saved readings. Short trips and route detail can be missed.',Date.now());
    } catch(error) {this.store.status(error.budget?'budget_paused':'error',error.message);} finally {this.running=false;}
  }
  start() {
    if(this.config.mode!=='polling') return;
    if(!this.config.billingVerified) {this.store.status('paused','Confirm the Tesla account allowance before enabling collection.');return;}
    this.stopped=false;
    const run=async()=>{await this.poll();if(!this.stopped)this.timer=setTimeout(run,this.config.pollSeconds*1000);};
    this.timer=setTimeout(run,1000);
  }
  stop() {this.stopped=true;if(this.timer)clearTimeout(this.timer);}
}
