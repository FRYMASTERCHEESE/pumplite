function n(e,r){if(typeof e!="bigint"||e<=0n)throw Error("Invalid gas estimate");let t=(e*12n+9n)/10n;if(t>r)throw Error("Gas estimate exceeds the reviewed execution budget");return t}export{n as a};
