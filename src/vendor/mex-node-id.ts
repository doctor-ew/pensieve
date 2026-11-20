// Adapted from MEX src/graph/extraction/node-id.ts, commit
// e5d4b93c84f09b946edc890859c7479700c2ee52. MIT; see THIRD_PARTY_NOTICES.md.
// Pensieve accepts a string kind; the identity/hash algorithm is unchanged.
import {createHash} from 'node:crypto';
export function generateNodeId(filePath:string,kind:string,name:string,qualifiedName=name,declarationRole=kind,signature=''):string {
  const identity=[filePath.replaceAll('\\','/'),kind,qualifiedName.replace(/\s+/g,' ').trim(),declarationRole,signature.replace(/\s+/g,' ').trim()].join('\0');
  return `${kind}:${createHash('sha256').update(identity).digest('hex').substring(0,32)}`;
}
