export const clientTiers=['STANDARD','SOCIAL','PREMIUM'] as const;
export type ClientTier=typeof clientTiers[number];
export interface LoyaltyPolicy {
  readonly tier:ClientTier;
  readonly bonusRateBps:number;
  discountBps(product:{socialEligible:boolean}):number;
}
export class StandardPolicy implements LoyaltyPolicy {
  readonly tier='STANDARD';readonly bonusRateBps=200;
  discountBps(){return 0;}
}
export class SocialPolicy implements LoyaltyPolicy {
  readonly tier='SOCIAL';readonly bonusRateBps=200;
  discountBps(product:{socialEligible:boolean}){return product.socialEligible?1000:0;}
}
export class PremiumPolicy implements LoyaltyPolicy {
  readonly tier='PREMIUM';readonly bonusRateBps=300;
  discountBps(){return 500;}
}
export function roundBps(amount:number,bps:number):number {
  if(!Number.isSafeInteger(amount)||amount<0||!Number.isInteger(bps)||bps<0||bps>10000)throw Error('Invalid money or basis points.');
  return Number((BigInt(amount)*BigInt(bps)+5000n)/10000n);
}
