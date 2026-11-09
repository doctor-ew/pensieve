import type {APIGatewayProxyEventV2,APIGatewayProxyStructuredResultV2} from 'aws-lambda';
import type {AwsAudit} from './aws-audit.js';
import type {HostedSessions} from './hosted-sessions.js';
import type {TeamRepository} from './repositories.js';
/** Record completed access, never request contents or grant/credential values. */
export function httpAudit(audit:AwsAudit,sessions:HostedSessions,store:TeamRepository){
 return async(event:APIGatewayProxyEventV2,response:APIGatewayProxyStructuredResultV2)=>{
  if(!response.statusCode||response.statusCode<200||response.statusCode>=300)return;
  const path=event.rawPath,method=event.requestContext.http.method;
  const reader=/^\/api\/reader\/([a-f0-9]{32})(?:\/(download|ask))?$/.exec(path);
  const memory=/^\/api\/team\/pools\/([^/]+)\/(memories|search|export)$/.exec(path);
  const action=reader?(method==='GET'?(reader[2]==='download'?'share.download':!reader[2]?'share.open':undefined):method==='POST'&&reader[2]==='ask'?'share.search':undefined):memory?(method==='GET'&&memory[2]==='memories'?'memory.list':method==='POST'&&memory[2]==='search'?'memory.search':method==='POST'&&memory[2]==='export'?'memory.export':undefined):method==='POST'&&path==='/api/team/logout'?'session.logout':undefined;
  if(!action)return;
  let actorId:string|undefined;
  if(!reader){
   const bearer=/^Bearer (.+)$/.exec(event.headers.authorization??'')?.[1];
   const cookie=event.cookies?.join('; ')??event.headers.cookie??'';
   const token=/(?:^|;\s*)pensieve_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1];
   try{actorId=bearer?(await store.authenticate(bearer)).id:token?(await sessions.get(token))?.userId:undefined;}catch{/* Revocation can occur after the original successful request. */}
  }
  await audit.record({id:'http:'+event.requestContext.requestId,action,...(actorId?{actorId}:{}),...(reader?{targetId:reader[1]}:{}),...(memory?{poolId:memory[1],targetId:memory[1]}:{}),outcome:'success'});
 };
}
