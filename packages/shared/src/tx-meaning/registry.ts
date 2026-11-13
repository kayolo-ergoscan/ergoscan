/**
 * Contract roles, in code until ergo-names carries a `role` field (separate proposal).
 * A role is matched by ErgoTree template hash (SHA-256 of the template bytes, the value on
 * packed.script.template_hash), else by an NFT the box holds, else by address.
 *
 * Sources, per entry:
 *   names   = /root/ergo-names/projects/<file>.json at f521adc (address → template hash computed
 *             with sigmastate, or the token match as published);
 *   chain   = read from live boxes that hold the protocol's NFT or sit at its published address;
 *   derived = seen spent beside a known pool and paying the order owner (evidence, not a publication);
 *   guess   = shape and token names only; the rule marks the answer conf "guess".
 *   code    = compiled from the protocol's own contract source and seen on live mainnet boxes:
 *             cruxfinance/crux-contracts at 677a2ed (compiled/, verification/contracts/);
 *             nautls/machinafi-sdk at 99608a9 (MIT; trees in src/grid-order.ts, src/limit-order.ts).
 */
import { LOCK_BY_ADDRESS } from "../lock-addresses.js";
import {
  ERG_USD_ORACLE_NFT,
  ERG_USD_ORACLE_NFT_V1,
  ERGUSD_PT,
  GOLD_POOL_NFT,
  GOLD_POOL_ORACLE_TOKENS,
  MORACLE_NFT,
  MORACLE_POOL_NFT,
  USD_POOL_NFT,
  USD_POOL_ORACLE_NFT,
} from "../registers.js";
import { AGEUSD_BANK_NFTS, SIGRSV_TOKEN_ID, SIGUSD_TOKEN_ID } from "../ageusd.js";
import { MINERS_FEE_ADDRESS } from "../tx-shape.js";

export type ProtocolId =
  | "ergo"
  | "oracle"
  | "ergodex"
  | "crux"
  | "lithosdex"
  | "lithos"
  | "rosen"
  | "sigmausd"
  | "sigmafi"
  | "duckpools"
  | "auction"
  | "ergomixer"
  | "ergonames"
  | "phoenix"
  | "basis"
  | "dexy"
  | "machinafi";

/** Display names. Every former pool of the ErgoDex project is named ErgoDex. */
export const PROTOCOL_NAMES: Readonly<Record<ProtocolId, { ru: string; en: string }>> = {
  ergo: { ru: "Ergo", en: "Ergo" },
  oracle: { ru: "Оракул", en: "Oracle" },
  ergodex: { ru: "ErgoDex", en: "ErgoDex" },
  crux: { ru: "Crux", en: "Crux" },
  lithosdex: { ru: "LithosDex", en: "LithosDex" },
  lithos: { ru: "Lithos", en: "Lithos" },
  rosen: { ru: "Rosen", en: "Rosen" },
  sigmausd: { ru: "SigmaUSD", en: "SigmaUSD" },
  sigmafi: { ru: "SigmaFi", en: "SigmaFi" },
  duckpools: { ru: "Duckpools", en: "Duckpools" },
  auction: { ru: "Auction House", en: "Auction House" },
  ergomixer: { ru: "ErgoMixer", en: "ErgoMixer" },
  ergonames: { ru: "ErgoNames", en: "ErgoNames" },
  phoenix: { ru: "Phoenix", en: "Phoenix" },
  basis: { ru: "Basis", en: "Basis" },
  dexy: { ru: "Dexy", en: "Dexy" },
  machinafi: { ru: "MachinaFi", en: "MachinaFi" },
};

export function protocolName(id: string | null | undefined, lang: "ru" | "en" = "en"): string | null {
  if (!id) return null;
  const hit = (PROTOCOL_NAMES as Record<string, { ru: string; en: string }>)[id];
  return hit ? hit[lang] : id;
}

export type ContractRole =
  // consensus
  | "emission"
  | "reward-lock"
  | "emission-proxy"
  | "reemission"
  | "miner-fee"
  // oracle pools
  | "datapoint"
  | "oracle-pool"
  | "oracle-refresh"
  | "oracle-governance"
  | "oracle-live-epoch"
  | "oracle-epoch-prep"
  // exchanges
  | "pool"
  | "order"
  | "provision"
  // bridge
  | "bridge-permit"
  | "bridge-commitment"
  | "bridge-trigger"
  | "bridge-lock"
  | "bridge-upkeep"
  // lending
  | "bank"
  | "lending-pool"
  | "loan-order"
  | "bond"
  | "loan-box"
  // names
  | "name-commit"
  | "name-reveal"
  | "name-registry"
  | "name-upkeep"
  // other
  | "lot"
  | "mixer"
  | "reserve"
  | "stable-mint"
  | "payout"
  | "upkeep";

export type RoleSource = "names" | "chain" | "derived" | "guess" | "code";

export type RoleEntry = {
  p: ProtocolId;
  role: ContractRole;
  /** Contract name for «Как определили» and for «вызвал «…»». */
  label: string;
  src: RoleSource;
  /** Venue name when the role is a pool and the venue differs from the protocol name. */
  venue?: string;
};

type Row = [hash: string, p: ProtocolId, role: ContractRole, label: string, src: RoleSource, venue?: string];

/** By ErgoTree template hash. */
const TEMPLATE_ROWS: Row[] = [
  // Ergo protocol (ergo-protocol.json)
  ["682db8df7a2a5aab16bfb90542fb796fa56d99ff056883b9293834ac0543c0f2", "ergo", "emission", "Emission", "names"],
  ["961e872f7ab750cb77ad75ea8a32d0ea3472bd0c230de09329b802801b3d1817", "ergo", "reward-lock", "Miner reward lock", "chain"],
  ["707c363f0914aeff3554f5e69bbed62921135007caaa449e16d682a9240c5d81", "ergo", "emission-proxy", "Emission proxy", "names"],
  ["ae9ac8d914dcf12f94410683a5980dc2edb510920dbd83773e516cca5fd58681", "ergo", "reemission", "Reemission", "names"],
  ["5b710d70f207f03745a8bb713006f235446f0104f89e977ae066ae184c0494fa", "ergo", "miner-fee", "Miner fee", "names"],

  // Oracle pools (oracle-pools.json). v2: pool, refresh, datapoint. v1: live epoch, epoch prep, datapoint.
  ["fcbf6946412dbc9528b24d134c58c8f06c15cb84b13f38e59caf9fe1bd9ba764", "oracle", "datapoint", "Oracle datapoint", "names"],
  ["6c4c6cd7754877bc3b3e590209d8c8fa1c70303140cfdf62071c433956037a50", "oracle", "datapoint", "Oracle datapoint v1", "names"],
  ["416babd63f0154df53b3b2f58891fa275048309978b1a1bde7e312f4f13bf2be", "oracle", "oracle-pool", "Oracle pool", "names"],
  ["cb5001639bacb19fe35f9ea25e56fbe2d2b3b2ff77a2b11e5a0f14e40187fe59", "oracle", "oracle-refresh", "Oracle refresh", "chain"],
  ["19e4db35624440663cff2f557a32bc714180a199b9cf4cf52910349e7419c180", "oracle", "oracle-live-epoch", "Oracle v1 live epoch", "names"],
  ["f6f982fa50028a18a6459ab046f1f93d05a598dd57c913921c01cf186b9c5cdc", "oracle", "oracle-epoch-prep", "Oracle v1 epoch prep", "names"],

  // ErgoDex (ergo-names project ErgoDex): AMM pools; CL position pools; swap orders.
  ["2dcc7830afe8f355b945850c60ff2b41fdb3e8ade07fde0a7c8a3ec498e8c3f6", "ergodex", "pool", "ErgoDex AMM Pool (ERG/token)", "names"],
  ["3c09deff3b5f49329149d18e02aab675ef6957bf6559a5c7dba817fee883fb3e", "ergodex", "pool", "ErgoDex AMM Pool (token/token)", "names"],
  ["83d0e88be351507dde3d6adef042c380af82072fb791ae5c5d4e3b711fd3b4cd", "ergodex", "pool", "ErgoDex AMM Pool (older)", "chain"],
  ["64607fe0fe3c0e5fd7c41ca1f1d65e48270da2f98e9a17049bfb2172356b5b5f", "ergodex", "pool", "ErgoDex V3 position", "chain", "ErgoDex V3"],
  // Earlier CL shell generation (crux-contracts compiled/cl-shell.ergotree.hex), retired; boxes h1879687–1904117.
  ["3711297e58fc65a14db87166ed19d5c1202a5484990066b417c165aa842c6e88", "ergodex", "pool", "ErgoDex V3 position (earlier shell)", "code", "ErgoDex V3"],
  ["36d1944fe6d743312e93541a1daf5592519772310ce924b2ec10e3f9b450e13a", "ergodex", "order", "ErgoDex swap order", "derived"],

  // ErgoDex constant-product pools with a fee tier in R4 (crux-contracts cp-pool-n2t.es /
  // cp-pool-t2t.es, mainnet-staging trees). Their NFT and LP tokens are named "ErgoDex Pool …" / "ErgoDex LP …".
  ["c3c45fea8455be2bc91785cbcaa4a41913e9866e1604aee135e283381e6ef3b1", "ergodex", "pool", "ErgoDex CP pool (ERG/token)", "code", "ErgoDex CP"],
  ["d685202ad30554f9a0b0b32b0b3cab866f8786a14f87b91b1fbfbab422674d0c", "ergodex", "pool", "ErgoDex CP pool (token/token)", "code", "ErgoDex CP"],
  // CL governance (crux-contracts cl-config.es, cl-config-source.es, cl-config-approval.es).
  ["a2c854d1d54f0d71ecf922f3c465dfd4de9afda46b178f60a382df4d882cb364", "ergodex", "upkeep", "ErgoDex CL config", "code"],
  ["b8c7239f3f5f1f9bcc5223fb62c17c1dd6dd00875537b6aef6a31c149eb81715", "ergodex", "upkeep", "ErgoDex CL config source", "code"],
  ["1a50aab5451337b8dea00c3fde51069f0b07f9ab988e47325db9719f78a28332", "ergodex", "upkeep", "ErgoDex governance approval", "code"],

  // MachinaFi orders (machinafi-sdk src/contracts): two-way grid ERG/token and token/token, and the
  // ERG/token limit order with partial fills. A fill recreates the box bound to it by id (R6 / R7).
  ["a68900b67ff5d74f74e7907aca83680adfc8ba01c1925430339d9e4c3f5dd0a3", "machinafi", "order", "MachinaFi grid order (ERG/token)", "code"],
  ["1ae21acb88ddc97279ae72fd9461e6f2cb13ad462dd4ca45c73e858bd68ebc23", "machinafi", "order", "MachinaFi grid order (token/token)", "code"],
  ["03ef002b73a894198c7c9a4332ba28ca000dc6c40cb801f0c719940d9a6a8f6b", "machinafi", "order", "MachinaFi limit order (ERG/token)", "code"],

  // Crux limit orders (crux-contracts limit-order*.es, EIP-5 templates) and the v2 fee box.
  ["5bf80359e972819567d53d443126d8cc58bed7e8fe57dfb3770b09a84fa68aae", "crux", "order", "Crux limit order v1", "code"],
  ["7a55e3f4a0c195e5570de7832becda0d52b676d0a9a29a27b6e84b5a28b8106d", "crux", "order", "Crux limit order v2", "code"],
  ["d33a869b6abd7d98a212a9657b27b8f0519eab950e6fb026849262f8e34f5438", "crux", "order", "Crux limit order fee", "code"],
  ["cb3087cb229ef0ff020553ecf398908cff6de06cb21888a7cfc4565060ff4acd", "crux", "order", "Crux limit order v3", "code"],

  // LithosDex pools (chain; tx-action LITHOS_SWAP) and provision (lithos.json).
  ["2de640e37a49cc9d95a08f2678da9f5e9aba56e08dfbc0662a64d225093156e3", "lithosdex", "pool", "LithosDex pool", "chain"],
  ["2002fbd6c3a75972aa99fa53f0bc2c236be1ce28e354719dfea769a8ec3e7753", "lithosdex", "pool", "LithosDex pool", "chain"],
  ["a6e7f1bc292ddc7ab8be30d304926fe9cc15760581cc73e995a8c971f1fc63c9", "lithosdex", "pool", "LithosDex pool", "chain"],
  ["1253a7f2c8fe3c687d16ffe2a296acb826bc2abac6d1c0dfb95f246e438c773c", "lithosdex", "pool", "LithosDex pool", "chain"],
  ["ec8631e580566f40740ba55c010432955c8539a74e9f60d40a65007c354849d6", "lithosdex", "pool", "LithosDex pool", "chain"],
  ["938b8ae08a1675558e8177b21524f95758ae0217ca41327492fae472c80466c9", "lithosdex", "provision", "LithosDex provision", "names"],

  // Rosen bridge (rosen-bridge.json).
  ["0416175ab49d6089cbb9f7e04407fad171d4807985953f11438d2b61b04d3891", "rosen", "bridge-permit", "Rosen Watcher Permit", "names"],
  ["5cc1ea1a0f7aaeae9e3e6261923cf61708ea049dc4384e4b93f8fb601ef1b28b", "rosen", "bridge-commitment", "Rosen Commitment", "names"],
  ["856c43fe0610c87b0759abeb83c7999980eb750d711e75ef7d326f5bda89cda9", "rosen", "bridge-trigger", "Rosen Event Trigger", "names"],
  ["7df7d49c680505ae413376e59e9970df4429741b33f095676bec3e4126de846d", "rosen", "bridge-lock", "Rosen Lock", "names"],
  ["44f78dee2f477af5082619fd6c3f639a724ed75c18c41556b8875a108b4126e6", "rosen", "bridge-upkeep", "Rosen Cold", "names"],
  ["f083eb657c08b361a1ea0f42faef91a421498b167360557164bda211830104c5", "rosen", "bridge-upkeep", "Rosen Emission", "names"],
  ["0c7face721e43f6e936356ecc43d76f1df9fb5446581038873e1009785a7a57e", "rosen", "bridge-upkeep", "Rosen Watcher Collateral", "names"],
  ["9b633bf518fc269f015e38d1b14fb047335828f25c3cc63658014748cb35841d", "rosen", "bridge-upkeep", "Rosen RWT Repo", "names"],
  ["19496a689239abf5c30d7ccd9accc1b8b19101b7e80714b7782d9e255e7461ec", "rosen", "bridge-upkeep", "Rosen Fraud", "names"],
  ["087c81a73e25fa86db1df5eac6d431393ba74100fc5b137e349243683f6af9aa", "rosen", "bridge-upkeep", "Rosen Guard Sign", "names"],
  ["141bee6b036d4c089123a25ad9e3e743945449e7d577f03217b16ba50f120f90", "rosen", "bridge-upkeep", "Rosen Repo Config", "names"],

  // Lithos mining protocol (lithos-protocol.json).
  ["41933d09756b700f0c01d1bcac9db37a92cac7eadb6261b57222855479c92c56", "lithos", "upkeep", "Lithos holding", "names"],
  ["db686aa7db208ce69f0088e66b731e3cd16a0f58332ccaad9b67bcb0555ea98d", "lithos", "upkeep", "Lithos emission gate", "names"],
  ["83468728045906b6eb74daa9805e9d997630fdd9d4844d37d253810dddff9415", "lithos", "upkeep", "Lithos emission", "chain"],
  ["3328cef917f9983ffcae8a3117fba409a7780c672bdfc09343245d3376f207fd", "lithos", "upkeep", "Lithos collateral", "names"],
  ["f451a412b3e792a31f174cebedbbc84ce22110ff1bc15dfe7702aa63f3ed1796", "lithos", "upkeep", "Lithos difficulty accumulator", "names"],
  ["09d67ac30249ac79de61d1a9a91d8c63749f99016512d42c5c606108469e5f3b", "lithos", "upkeep", "Lithos evaluation", "names"],
  ["b260eaf725ad4c43fd14108ef4a0c85439e6b79891ac368e27005bd77d771913", "lithos", "upkeep", "Lithos miner data", "names"],
  ["73848daf47ae3eb1d6f8a53ed06d4aea86281516740452ed80404bade4f36c34", "lithos", "upkeep", "Lithos difficulty forwards", "names"],
  ["5a0f7e9f1c93a358da0733bc5aad9918aa775683a98fe2dc90ccc7ef15bac1b7", "lithos", "payout", "Lithos payout", "names"],

  // SigmaUSD bank (sigmausd.json; tx-action SIGMAUSD).
  ["246e14059ac2d7642929d5486007ec55d0522936391ba60564ec84d44b19e430", "sigmausd", "bank", "SigmaUSD Bank", "names"],

  // SigmaFi (chain: borrower order and the bond it turns into).
  ["cd8636b877e7ff1a634dd2c2a7ee961ae66039bc616ba517ee9511723126dac7", "sigmafi", "loan-order", "SigmaFi loan order", "chain"],
  ["9ed98deca6a6546ff0be8f8c2f66b60d2d6e58bab1a2ce93d97df76c39198909", "sigmafi", "bond", "SigmaFi bond", "chain"],

  // Duckpools (duckpools.json for the ERG pool; the loan box is a guess).
  ["93cd1a009168a06a02f5adb09dd9e88a82aca7c43b7818998d7b2b3f9aac856a", "duckpools", "lending-pool", "Duckpools ERG Lending Pool", "names"],
  ["db697243c2c862454a4be4c7cebf5cdb75a9d360e9297cb1543acfb0a32c5bd0", "duckpools", "loan-box", "Duckpools loan", "guess"],

  // Auction House, ErgoMixer, ErgoNames, Phoenix, Basis (their project files).
  ["3d578e5cfa4a4314f18d7f716e442c79709e36bd861a7ebc1617fa0b122a0d68", "auction", "lot", "Auction House", "names"],
  ["c5328d694b9892d54f1d9a335a9e962f9ce3e38886b5ef676c4783fdbc1f73db", "ergomixer", "mixer", "ErgoMixer Fee Emission", "names"],
  ["b05e92b987d2a8d8cbf875d4e0bad58c4bfc36d9e2263a4527afaa24f9d7f84e", "ergomixer", "mixer", "ErgoMixer Full Mix", "names"],
  ["87acd62e5d40d5e0c7ae725ad757930173ce6b682bafbe5c5e98e80ddd8ee979", "ergomixer", "mixer", "ErgoMixer Half Mix", "names"],
  ["ab4e4dc33cd11fa2dbaf989b0988f6f94e29948b195227b3e65174d540cc83fb", "ergomixer", "mixer", "ErgoMixer Token Emission", "names"],
  ["30aed6f0919e44463dfb8d4c8c56d5135fa90f6220bbf003cf6cdcf92fe91365", "ergonames", "name-commit", "ErgoNames Commit", "names"],
  ["4e120759099519dccd72fe34f30e408d727a715b804b1843a7b804d55a2a979f", "ergonames", "name-commit", "ErgoNames Reveal Proxy", "names"],
  ["8896acf1c6a81996a539c0cddd0412632b5aacf324c94406da79cddad070da24", "ergonames", "name-reveal", "ErgoNames Reveal", "names"],
  ["7ab60ede21ce35f55f38eb48d10130a98245c3b4572d6e04832c7f7d86df2583", "ergonames", "name-registry", "ErgoNames Registry", "names"],
  ["7088c0a26576bc1d13940263c4918d66c2dc2a685cc5e32cbbba3acd3f14f851", "ergonames", "name-registry", "ErgoNames Subname Registry", "names"],
  ["ffa4d65f739e289111db821acbcf6ad0b89750fd875d0ed51898c3061979c506", "ergonames", "name-upkeep", "ErgoNames Collection", "names"],
  ["c7c5a98a7a180e373b15d62d123dc370e223824b9789f65f7b9a2925c797b7d0", "ergonames", "name-upkeep", "ErgoNames Fee Split", "names"],
  ["8b5dac35309da7996c2b39b7010a9ec9d46a8b6e80387e0b949db7a3ec4df156", "phoenix", "bank", "Phoenix hodlERG Bank", "names"],
  ["5811576e4c7dff58cf55c7f3808638076659183cdbf23d00bf92b4d157e58c78", "phoenix", "bank", "Phoenix hodlToken Bank", "names"],
  ["0a2f8340e45f12e40746d0f8dbf08095357aa43ca63c269b10a3927421e2b577", "basis", "reserve", "Basis ERG reserve", "names"],
  ["47b6c65a3e229d4443999cb0433070c27d4b10f9bbfc068862d3ede62ff135ca", "basis", "reserve", "Basis token reserve", "names"],
];

/** By an NFT the box holds (the project publishes the token, not the script). */
const TOKEN_ROWS: Row[] = [
  // Oracle pools (oracle-pools.json; registers.ts).
  [USD_POOL_NFT, "oracle", "oracle-pool", "USD v2 Oracle Pool", "names"],
  ["19b7f2e2f11052c020800c8b620660f9f0b5fd5b3f2beacc8b44af960477a694", "oracle", "oracle-refresh", "USD v2 Oracle Refresh", "names"],
  ["30e273698c85bbe66319904c499bfefbd76f51487688d674b20623715ff0741b", "oracle", "oracle-governance", "USD v2 Oracle Update", "names"],
  [GOLD_POOL_NFT, "oracle", "oracle-pool", "XAU/ERG Oracle Pool", "names"],
  ["97ad159235d25d05d7efc5863b5d360f89d7d668409502058be3e7aac177b9cb", "oracle", "oracle-refresh", "XAU/ERG Oracle Refresh", "names"],
  ["05fd350e60df5f35c1ca457687abf54e2f03b92f8e2c1ebbba912fc42acfeda4", "oracle", "oracle-refresh", "XAU/ERG Oracle Refresh (2023)", "names"],
  ["a5552e3889c650328ce5b4c93cb0b341c4b236b23623341e5ace710a395e12c9", "oracle", "oracle-governance", "XAU/ERG Oracle Update", "names"],
  [MORACLE_POOL_NFT, "oracle", "oracle-pool", "MORACLE Pool", "names"],
  // SigmaUSD bank NFTs (ageusd.ts).
  ...AGEUSD_BANK_NFTS.map((id): Row => [id, "sigmausd", "bank", "SigmaUSD Bank", "chain"]),
  // Dexy (dexy.json): every role box carries its NFT.
  ["78c24bdf41283f45208664cd8eb78e2ffa7fbb29f26ebb43e6b31a46b3b975ae", "dexy", "stable-mint", "USE Bank", "names"],
  ["40db16e1ed50b16077b19102390f36b41ca35c64af87426d04af3b9340859051", "dexy", "stable-mint", "USE FreeMint", "names"],
  ["c79bef6fe21c788546beab08c963999d5ef74151a9b7fd6c1843f626eea0ecf5", "dexy", "stable-mint", "USE Arbitrage Mint", "names"],
  ["4ecaa1aac9846b1454563ae51746db95a3a40ee9f8c5f5301afbe348ae803d41", "dexy", "pool", "USE LP Pool", "names", "Dexy"],
  ["2cf9fb512f487254777ac1d086a55cda9e74a1009fe0d30390a3792f050de58f", "dexy", "upkeep", "USE LP Mint", "names"],
  ["1bfea21924f670ca5f13dd6819ed3bf833ec5a3113d5b6ae87d806db29b94b9a", "dexy", "upkeep", "USE LP Redeem", "names"],
  ["a2482fca4ca774ef9d3896977e3677b031597c6e312b0c10d47157bb0d6ed69f", "dexy", "payout", "USE Payout", "names"],
  ["dbf655f0f6101cb03316e931a689412126fefbfb7c78bd9869ad6a1a58c1b424", "dexy", "upkeep", "USE Intervention", "names"],
  ["bc685d6ad1703ba5775736308fd892807edc04f48ba7a52e802fab241a59962c", "dexy", "upkeep", "USE Extract to Future", "names"],
  ["57af5c7446d419e98e2e6fbd4bce9029cd589f8094686c457902feb472f194ec", "dexy", "upkeep", "USE Tracking", "names"],
  ["ef461517a55b8bfcd30356f112928f3333b5b50faf472e8374081307a09110cf", "dexy", "upkeep", "Dexy LP Swap", "names"],
  ["75d7bfbfa6d165bfda1bad3e3fda891e67ccdcfc7b4410c1790923de2ccc9f7f", "dexy", "stable-mint", "DexyGold Bank", "names"],
  ["74f906985e763192fc1d8d461e29406c75b7952da3a89dbc83fe1b889971e455", "dexy", "stable-mint", "DexyGold FreeMint", "names"],
  ["3fefa1e3fef4e7abbdc074a20bdf751675f058e4bcce5cef0b38bb9460be5c6a", "dexy", "stable-mint", "DexyGold Arbitrage Mint", "names"],
  ["905ecdef97381b92c2f0ea9b516f312bfb18082c61b24b40affa6a55555c77c7", "dexy", "pool", "DexyGold LP Pool", "names", "Dexy"],
  ["10b755771f7253cff9727a9ca54bb2867e22b1b236657051c47ea9556c517e10", "dexy", "upkeep", "DexyGold LP Mint", "names"],
  ["471057efea32bf406d529902217844a258d3d6bedfcdcd3cfbab01872cc0b74c", "dexy", "upkeep", "DexyGold LP Redeem", "names"],
  ["26ef992a598eadfddabfd3c51509fb277b075c943b17199407f68c467b9de1ae", "dexy", "payout", "DexyGold Payout", "names"],
  ["6597acef421c21a6468a2b58017df6577b23f00099d9e0772c0608deabdf6d13", "dexy", "upkeep", "DexyGold Intervention", "names"],
  ["615be55206b1fea6d7d6828c1874621d5a6eb0e318f98a4e08c94a786f947cec", "dexy", "upkeep", "DexyGold Extract to Future", "names"],
  ["ff5269b5cdd037ea391b7210e28aeae0034ef670b9c4263995fe2a920e8d5a1d", "dexy", "upkeep", "DexyGold Tracking", "names"],
  ["bb484bb7fea08b15861e27cb203a13069082befb05f5437cae71237d9c5c6ac3", "dexy", "upkeep", "GORT Dev Emission", "names"],
  // Phoenix (phoenix.json): token-matched bank.
  ["0a9a8f5e7226222af86769e0a6a0455e53b9295f600a3e8a6107bca1d6aaf35d", "phoenix", "bank", "Phoenix hodlComet10 Bank", "names"],
  // Lithos (lithos.json, lithos-protocol.json).
  ["c0b21ac51481a5d242809d9b1e189a8baf3803fe347ca01833c1aeb380e6eb29", "lithosdex", "pool", "Lithos ERG/LIT pool", "names"],
  ["7f45bcbf13b9925c3eef35ff247ae46b80db2e2703ce2a8bfddf294e1e60c2d7", "lithosdex", "upkeep", "LithosDex fee vault", "names"],
  ["1ddb641b785e9ac9baf455f64932295e48cbbf4aadc9645f74065d58d09cdc47", "lithos", "upkeep", "Lithos emission", "names"],
  ["34a44f069c15ff92038803c6c21194f2c9a194f3a610c40ee1ef2773bdfc5c35", "lithos", "upkeep", "Lithos emission config", "names"],
  ["ff9b0d78e6705b3d55936b22b668761f484524a99fa1a7c6e9f7cd75119a1bbd", "lithos", "upkeep", "Lithos miner dictionary", "names"],
  ["0001bb75d59f66c3d563576c51bfaa8ea316ee23b4d52f3f139a4f00df19fe62", "lithos", "upkeep", "Lithos fraud proof control", "names"],
];

function index(rows: Row[]): Map<string, RoleEntry> {
  const m = new Map<string, RoleEntry>();
  for (const [hash, p, role, label, src, venue] of rows) {
    const key = hash.toLowerCase();
    if (m.has(key)) continue;
    m.set(key, venue ? { p, role, label, src, venue } : { p, role, label, src });
  }
  return m;
}

const BY_TEMPLATE = index(TEMPLATE_ROWS);

/**
 * Templates whose registers the rules read, so list views load registers for these boxes only:
 * Rosen lock and event trigger (chain name); MachinaFi orders (R4 owner, R6/R7 parent binding).
 */
export const TEMPLATES_WITH_REGISTERS: readonly string[] = [
  "7df7d49c680505ae413376e59e9970df4429741b33f095676bec3e4126de846d",
  "856c43fe0610c87b0759abeb83c7999980eb750d711e75ef7d326f5bda89cda9",
  "a68900b67ff5d74f74e7907aca83680adfc8ba01c1925430339d9e4c3f5dd0a3",
  "1ae21acb88ddc97279ae72fd9461e6f2cb13ad462dd4ca45c73e858bd68ebc23",
  "03ef002b73a894198c7c9a4332ba28ca000dc6c40cb801f0c719940d9a6a8f6b",
];
const BY_TOKEN = index(TOKEN_ROWS);

/** Which pair an oracle box serves, by the pool NFT or the operator token it carries. */
const ORACLE_PAIR = new Map<string, string>([
  [ERG_USD_ORACLE_NFT, "ERG/USD"],
  [ERG_USD_ORACLE_NFT_V1, "ERG/USD"],
  [ERGUSD_PT, "ERG/USD"],
  [USD_POOL_NFT, "ERG/USD"],
  [USD_POOL_ORACLE_NFT, "ERG/USD"],
  ["19b7f2e2f11052c020800c8b620660f9f0b5fd5b3f2beacc8b44af960477a694", "ERG/USD"],
  ["30e273698c85bbe66319904c499bfefbd76f51487688d674b20623715ff0741b", "ERG/USD"],
  [GOLD_POOL_NFT, "XAU/ERG"],
  ...GOLD_POOL_ORACLE_TOKENS.map((id): [string, string] => [id, "XAU/ERG"]),
  ["97ad159235d25d05d7efc5863b5d360f89d7d668409502058be3e7aac177b9cb", "XAU/ERG"],
  ["05fd350e60df5f35c1ca457687abf54e2f03b92f8e2c1ebbba912fc42acfeda4", "XAU/ERG"],
  ["a5552e3889c650328ce5b4c93cb0b341c4b236b23623341e5ace710a395e12c9", "XAU/ERG"],
  [MORACLE_POOL_NFT, "MORACLE"],
  [MORACLE_NFT, "MORACLE"],
]);

/** Tokens a stablecoin bank issues (so a mint is told from a redeem). */
export const STABLE_TOKENS: ReadonlySet<string> = new Set([SIGUSD_TOKEN_ID, SIGRSV_TOKEN_ID]);

export function roleByTemplate(hash: string | null | undefined): RoleEntry | null {
  if (!hash) return null;
  return BY_TEMPLATE.get(hash.trim().toLowerCase()) ?? null;
}

export function roleByToken(tokenId: string | null | undefined): RoleEntry | null {
  if (!tokenId) return null;
  return BY_TOKEN.get(tokenId.trim().toLowerCase()) ?? null;
}

export function oraclePairOf(tokenIds: readonly string[]): string | null {
  for (const id of tokenIds) {
    const hit = ORACLE_PAIR.get(id);
    if (hit) return hit;
  }
  return null;
}

const ADDRESS_ROLE: Record<string, ContractRole> = {
  emission: "emission",
  reemission: "reemission",
  "emission-proxy": "emission-proxy",
};

/** Role of one box: template first, then a held NFT, then a published address. */
export function roleOf(box: {
  templateHash?: string | null;
  address?: string | null;
  tokenIds: readonly string[];
}): RoleEntry | null {
  const t = roleByTemplate(box.templateHash);
  if (t) return t;
  for (const id of box.tokenIds) {
    const hit = roleByToken(id);
    if (hit) return hit;
  }
  const addr = box.address?.trim() ?? "";
  if (!addr) return null;
  if (addr === MINERS_FEE_ADDRESS) return { p: "ergo", role: "miner-fee", label: "Miner fee", src: "names" };
  if (addr.startsWith("88")) return { p: "ergo", role: "reward-lock", label: "Miner reward lock", src: "chain" };
  const lock = LOCK_BY_ADDRESS.get(addr);
  const role = lock ? ADDRESS_ROLE[lock] : undefined;
  if (role) return { p: "ergo", role, label: lock!, src: "names" };
  return null;
}

/** Every template the registry knows, for the weekly «незнакомые контракты» report. */
export function knownTemplateCount(): number {
  return BY_TEMPLATE.size;
}
