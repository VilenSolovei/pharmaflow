import { LoyaltyPanel } from './LoyaltyPanel';
import { useQuery } from '@tanstack/react-query';
import { accountRequest } from './account-api';
import { AuthPanel } from './AuthPanel';
import { ProfilePanel } from './ProfilePanel';
import { PrescriptionsPanel } from './PrescriptionsPanel';
export function AccountPage(){
 const account=useQuery({queryKey:['account'],queryFn:()=>accountRequest('me'),retry:false});
 if(!account.data||account.isError)return <AuthPanel/>;
 return <div key={account.data.id} className="account-content"><div className="account-sidebar"><AuthPanel/><ProfilePanel uid={account.data.id}/></div><div className="account-main"><LoyaltyPanel uid={account.data.id}/><PrescriptionsPanel uid={account.data.id}/></div></div>;
}
