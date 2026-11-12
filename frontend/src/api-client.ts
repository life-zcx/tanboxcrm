import type { Client, Deal, AIStatus, AdminUser, ConversationChunk, Message, AISuggestion } from './api';
import { frontendLogger } from './utils/frontend-logger';
export interface AccessUser { id:string; telegramChatId:string; telegramUsername:string|null; role:string; accessStatus:string; requestedAt:string|null; approvedAt:string|null; lastLoginAt:string; }
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
async function request<T>(path:string,options:RequestInit={},timeout=12000):Promise<T>{
  const method=options.method||'GET';
  const shouldLog = !path.startsWith('/logs') && !path.startsWith('/whatsapp/status') && !path.startsWith('/whatsapp/feed');
  if (shouldLog) {
    frontendLogger.info(`[API Запрос] ${method} /api${path}`);
  }
  const attempts=method==='GET'?2:1;
  for(let attempt=0;attempt<attempts;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    const abort=()=>controller.abort();
    options.signal?.addEventListener('abort',abort,{once:true});
    try{
      if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
      const response=await fetch('/api'+path,{...options,credentials:'same-origin',signal:controller.signal,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
      const data=await response.json().catch(()=>null);
      if(!response.ok){
        if(response.status===401)window.dispatchEvent(new Event('tanbox-unauthorized'));
        const errMsg = data?.error || 'Сервис временно недоступен. Повторите запрос.';
        if (shouldLog) {
          frontendLogger.error(`[API Ошибка ${response.status}] ${method} /api${path} -> ${errMsg}`);
        }
        throw new ApiError(response.status,errMsg);
      }
      if(data===null)throw new ApiError(502,'Сервер вернул некорректный ответ');
      return data as T;
    }catch(error){
      if(options.signal?.aborted)throw error;
      if(error instanceof ApiError&&error.status<500)throw error;
      if(attempt+1===attempts)throw error instanceof ApiError?error:new ApiError(0,'Нет ответа от сервера. Проверьте соединение и повторите запрос.');
      await new Promise(r=>setTimeout(r,400));
    }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
  }
  throw new ApiError(0,'Ошибка соединения');
}
const body=(value:unknown)=>JSON.stringify(value);
const query=(filters:Record<string,unknown>,includeAll=false)=>{const p=new URLSearchParams();Object.entries(filters).forEach(([k,v])=>{if(v!==undefined&&v!==''&&(includeAll||v!=='ALL'))p.set(k,String(v));});return p.toString();};
export const api={
  getAccessUsers:()=>request<{users:AccessUser[]}>('/access'),
  decideAccess:(id:string,action:'APPROVE'|'REJECT'|'REVOKE')=>request<{user:AccessUser}>('/access/'+encodeURIComponent(id)+'/decision',{method:'POST',body:body({action})}),
  requestCode:()=>request<{success:boolean;botUrl:string;expiresIn:number}>('/auth/request-code',{method:'POST',body:body({})}),
  verifyCode:(code:string)=>request<{user:AdminUser}>('/auth/verify-code',{method:'POST',body:body({code})}),
  getMe:(signal?:AbortSignal)=>request<{user:AdminUser|null}>('/auth/me',{signal}),
  logout:()=>request<{success:boolean}>('/auth/logout',{method:'POST',body:body({})}),
  getAIStatus:(signal?:AbortSignal)=>request<AIStatus>('/ai/status',{signal}),
  getClients:(filters:{search?:string;status?:string;category?:string;offset?:number;limit?:number}={},signal?:AbortSignal)=>request<{clients:Client[];total:number}>('/clients?'+query(filters),{signal}),
  getClient:(id:string,signal?:AbortSignal)=>request<{client:Client}>('/clients/'+encodeURIComponent(id),{signal}),
  createClient:(data:Partial<Client>)=>request<{client:Client}>('/clients',{method:'POST',body:body(data)}),
  updateClient:(id:string,data:Partial<Client>)=>request<{client:Client}>('/clients/'+encodeURIComponent(id),{method:'PUT',body:body(data)}),
  deleteClient:(id:string)=>request<{success:boolean;cleanupPending:number}>('/clients/'+encodeURIComponent(id),{method:'DELETE'},30000),
  getDeals:(filters:{stage?:string;offset?:number;limit?:number}={},signal?:AbortSignal)=>request<{deals:Deal[];total:number;amountTotal:number}>('/deals?'+query(filters),{signal}),
  createDeal:(data:{clientId:string;title:string;amount?:number;codesCount?:number;stage?:string})=>request<{deal:Deal}>('/deals',{method:'POST',body:body(data)}),
  updateDealStage:(id:string,stage:string,lossReason?:string)=>request<{deal:Deal}>('/deals/'+encodeURIComponent(id)+'/stage',{method:'PUT',body:body({stage,lossReason:lossReason||undefined})}),
  previewScreenshots:(files:File[],targetClientId?:string)=>{const form=new FormData();files.forEach(f=>form.append('screenshots',f));if(targetClientId)form.append('targetClientId',targetClientId);return request<any>('/messages/preview-screenshot',{method:'POST',body:form},60000);},
  commitScreenshots:(files:File[],reviewToken:string,parsed:unknown,targetClientId?:string)=>{const form=new FormData();files.forEach(f=>form.append('screenshots',f));if(targetClientId)form.append('targetClientId',targetClientId);form.append('reviewToken',reviewToken);form.append('parsed',JSON.stringify(parsed));return request<any>('/messages/commit-screenshot',{method:'POST',body:form},60000);},
  ingestText:(rawText:string,targetClientId?:string)=>request<any>('/messages/ingest-text',{method:'POST',body:body({rawText,targetClientId})},55000),
  addManualMessages:(clientId:string,payload:{requestId:string;channel:'WHATSAPP'|'TELEGRAM'|'OTHER';note?:string;messages:{sender:'CLIENT'|'MANAGER';content:string;time?:string}[]})=>request<{chunk:ConversationChunk;duplicate:boolean}>('/messages/client/'+encodeURIComponent(clientId)+'/manual',{method:'POST',body:body(payload)},20000),
  suggestReply:(payload:{clientId:string;quoteId?:string;userPrompt?:string;provider?:'GEMINI'|'OPENAI'|'AUTO';style?:'BUSINESS'|'FRIENDLY'|'CLOSING'|'EXPERT';intent?:'REPLY'|'COMMERCIAL_OFFER'})=>request<{suggestion:{suggestionId:string;reply:string;explanation:string;variations:string[];provider:string;commercialEvidence?:any;pricedOffer?:boolean;context?:{messageCount:number;lastClientMessage:string;lastManagerMessage:string}}}>('/ai/suggest-reply',{method:'POST',body:body(payload)},55000),
  getDraftChat:(clientId:string,intent:'REPLY'|'COMMERCIAL_OFFER',signal?:AbortSignal)=>request<{entries:AISuggestion[]}>('/ai/draft-chat?'+query({clientId,intent}),{signal}),
  reviseDraft:(payload:{clientId:string;suggestionId:string;instruction:string;style?:'BUSINESS'|'FRIENDLY'|'CLOSING'|'EXPERT'})=>request<{suggestion:{suggestionId:string;reply:string;explanation:string;variations:string[];provider:string;commercialEvidence?:any;pricedOffer?:boolean;context?:{messageCount:number;lastClientMessage:string;lastManagerMessage:string}}}>('/ai/draft-chat/revise',{method:'POST',body:body(payload)},55000),
  getPricing:(signal?:AbortSignal)=>request<any>('/ai/pricing',{signal},20000),
  getQuotes:(clientId:string,offset=0,signal?:AbortSignal)=>request<any>('/ai/quotes?'+query({clientId,offset,limit:20}),{signal}),
  createQuote:(clientId:string,input:unknown)=>request<any>('/ai/quotes',{method:'POST',body:body({clientId,input})},20000),
  revokeQuote:(id:string)=>request<{success:boolean}>('/ai/quotes/'+encodeURIComponent(id)+'/revoke',{method:'POST',body:body({})}),
  getKnowledge:(offset=0)=>request<any>('/settings/knowledge?limit=50&offset='+offset),
  getKnowledgeLibrary:(filters:Record<string,unknown>,signal?:AbortSignal)=>request<any>('/settings/knowledge/library?'+query(filters,true),{signal}),
  getKnowledgeDocument:(id:string,signal?:AbortSignal)=>request<any>('/settings/knowledge/library/documents/'+encodeURIComponent(id),{signal}),
  verifyKnowledgeLibrary:(importId:string)=>request<any>('/settings/knowledge/library/verify?importId='+encodeURIComponent(importId),{},30000),
  getWebKnowledge:(signal?:AbortSignal)=>request<any>('/settings/knowledge/web',{signal}),
  getWebKnowledgeDocument:(id:string,signal?:AbortSignal)=>request<any>('/settings/knowledge/web/documents/'+encodeURIComponent(id),{signal}),
  searchWebKnowledge:(search:string,category?:string)=>request<any>('/settings/knowledge/web/search?'+query({search,category})),
  lookupMarkingList:(code:string)=>request<any>('/settings/knowledge/web/list-lookup?'+query({code})),
  collectWebKnowledge:()=>request<any>('/settings/knowledge/web/collect',{method:'POST',body:'{}'}),
  createKnowledgeItem:(data:{category:string;title:string;content:string;reviewStatus?:string})=>request<any>('/settings/knowledge',{method:'POST',body:body(data)}),
  getConversations:(clientId:string,offset:number)=>request<{conversations:ConversationChunk[];total:number}>('/messages/client/'+encodeURIComponent(clientId)+'?limit=20&offset='+offset),
  getMessages:(chunkId:string,offset:number)=>request<{messages:Message[];total:number}>('/messages/chunk/'+encodeURIComponent(chunkId)+'/messages?limit=100&offset='+offset),
  getWhatsAppStatus:(signal?:AbortSignal)=>request<{status:'DISCONNECTED'|'SCAN_QR'|'CONNECTING'|'CONNECTED';qr:string|null;user:{phone?:string;name?:string}|null;error:string|null;syncStats:any;settings:any}>('/whatsapp/status',{signal}),
  connectWhatsApp:()=>request<{ok:boolean;notice:string}>('/whatsapp/connect',{method:'POST',body:'{}'}),
  logoutWhatsApp:()=>request<{ok:boolean;notice:string}>('/whatsapp/logout',{method:'POST',body:'{}'}),
  restartWhatsApp:()=>request<{ok:boolean;notice:string}>('/whatsapp/restart',{method:'POST',body:'{}'}),
  syncWhatsAppHistory:()=>request<{ok:boolean;notice:string;stats:any}>('/whatsapp/sync',{method:'POST',body:'{}'}),
  getWhatsAppFeed:(signal?:AbortSignal)=>request<{feed:any[];syncStats:any;settings:any}>('/whatsapp/feed',{signal}),
  updateWhatsAppSettings:(settings:{autoCreateLeads?:boolean;autoRunAi?:boolean})=>request<{ok:boolean;settings:any}>('/whatsapp/settings',{method:'POST',body:body(settings)}),
  getWhatsAppLogs:(params?:{limit?:number;filter?:string;level?:string},signal?:AbortSignal)=>request<{logs:any[]}>('/whatsapp/logs?'+query(params||{}),{signal}),
  clearWhatsAppLogs:()=>request<{ok:boolean;logs:any[]}>('/whatsapp/logs/clear',{method:'POST',body:'{}'}),
  getLogs:(params?:{limit?:number;category?:string;level?:string;search?:string},signal?:AbortSignal)=>request<{logs:any[]}>('/logs?'+query(params||{}),{signal}),
  sendFrontendLog:(level:'INFO'|'WARN'|'ERROR',message:string,details?:any)=>request<{ok:boolean}>('/logs/frontend',{method:'POST',body:body({level,message,details})}),
  clearLogs:()=>request<{ok:boolean;logs:any[]}>('/logs/clear',{method:'POST',body:'{}'}),
};
