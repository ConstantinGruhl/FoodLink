import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useQuery } from '../lib/hooks'
import { useWorkspace } from '../lib/workspace'
import { okSchema } from '../lib/schemas'
import { ActionMessages, Alert, ErrorPanel, Field, Loading, PageHead } from '../components/ui'
export default function Invitation() {
  const {token}=useParams(),auth=useAuth(),workspace=useWorkspace(),action=useAction(),[name,setName]=useState(''),[password,setPassword]=useState(''),[done,setDone]=useState(false)
  const query=useQuery(token?`/staff/invitations/${encodeURIComponent(token)}`:null,z.object({email:z.string(),role:z.string(),organizationName:z.string(),locationName:z.string().nullable(),existingAccount:z.boolean()}))
  return <><PageHead title="Join your charity team" description="Activate an invitation to add membership to your account."/>{query.loading?<Loading/>:query.error?<ErrorPanel error={query.error} retry={query.reload}/>:query.data&&<form className="card stack narrow" onSubmit={e=>{e.preventDefault();void action.run(async()=>{await mutation(`/staff/invitations/${encodeURIComponent(token!)}/accept`,okSchema,query.data!.existingAccount?{}:{name,password});await auth.refresh();workspace.reload();setDone(true)},'Your membership is active.')}}><h2>{query.data.organizationName}</h2><p>{query.data.locationName||'All charity locations'} · {query.data.role.replaceAll('_',' ')}</p><p>Invitation for {query.data.email}</p><ActionMessages error={action.error} success={action.success}/>{done?<Link className="btn" to="/workspace">Open team workspace</Link>:query.data.existingAccount && auth.user?.email.toLowerCase()!==query.data.email.toLowerCase()?<Alert kind="info">Sign in with {query.data.email} to accept this invitation. <Link to="/login" state={{from:`/invite/${token}`}}>Sign in</Link></Alert>:<>{!query.data.existingAccount&&<><Field label="Your name" required><input value={name} onChange={e=>setName(e.target.value)} required maxLength={120}/></Field><Field label="Choose your password" required hint="At least 12 characters. Keep it private."><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128}/></Field></>}<button className="btn" disabled={action.pending}>Accept invitation</button></>}</form>}</>
}
