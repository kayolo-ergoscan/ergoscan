/**
 * ergo-graphql surface Nautilus v1.3.3 and Fleet actually send.
 * Amounts are strings. This schema is not the explorer GraphQL schema.
 */
export const NAUTILUS_VERSION = "0.5.5";

export const NAUTILUS_SDL = /* GraphQL */ `
  scalar JSONObject

  enum HeightFilterType {
    creation
    settlement
  }

  type Query {
    info: Info!
    state: State!
    addresses(addresses: [String!]!): [Address!]!
    blockHeaders(
      skip: Int = 0
      take: Int = 10
      headerId: String
      headerIds: [String!]
      parentId: String
      height: Int
    ): [Header!]!
    boxes(
      skip: Int = 0
      take: Int = 50
      boxId: String
      boxIds: [String!]
      transactionId: String
      headerId: String
      spent: Boolean
      tokenId: String
      address: String
      addresses: [String!]
      ergoTree: String
      ergoTrees: [String!]
      ergoTreeTemplateHash: String
      minHeight: Int
      maxHeight: Int
      heightType: HeightFilterType = settlement
    ): [Box!]!
    tokens(
      skip: Int = 0
      take: Int = 50
      tokenId: String
      tokenIds: [String!]
      boxId: String
      name: String
    ): [Token!]!
    transactions(
      skip: Int = 0
      take: Int = 50
      transactionId: String
      transactionIds: [String!]
      headerId: String
      address: String
      addresses: [String!]
      minHeight: Int
      maxHeight: Int
    ): [Transaction!]!
    mempool: Mempool!
  }

  type Mutation {
    checkTransaction(signedTransaction: SignedTransaction!): String!
    submitTransaction(signedTransaction: SignedTransaction!): String!
  }

  type Info {
    version: String!
  }

  type Epochs {
    height: Int!
  }

  type State {
    network: String!
    blockId: String!
    height: Int!
    boxGlobalIndex: String!
    transactionGlobalIndex: String!
    difficulty: String!
    params: Epochs!
  }

  type Address {
    address: String!
    used: Boolean!
    balance: AddressBalance!
  }

  type AddressBalance {
    nanoErgs: String!
    assets(tokenId: String): [AddressAssetBalance!]!
  }

  type AddressAssetBalance {
    tokenId: String!
    amount: String!
    name: String
    decimals: Int
  }

  type Asset {
    tokenId: String!
    amount: String!
    "Position of the token in the box, node order (contracts read tokens(index))."
    index: Int!
    boxId: String!
  }

  type Box {
    boxId: String!
    transactionId: String!
    index: Int!
    value: String!
    creationHeight: Int!
    "Height of the block that included the box."
    settlementHeight: Int!
    ergoTree: String!
    address: String
    assets: [Asset!]!
    additionalRegisters: JSONObject!
    beingSpent: Boolean!
  }

  type Header {
    headerId: String!
    parentId: String!
    version: Int!
    height: Int!
    nBits: String!
    difficulty: String!
    timestamp: String!
    stateRoot: String!
    adProofsRoot: String!
    transactionsRoot: String!
    extensionHash: String!
    powSolutions: JSONObject!
    votes: [Int!]!
  }

  type Token {
    tokenId: String!
    boxId: String!
    emissionAmount: String!
    name: String
    description: String
    type: String
    decimals: Int
    box: Box!
  }

  type Input {
    boxId: String!
    transactionId: String!
    proofBytes: String
    extension: JSONObject!
    index: Int!
    box: Box
  }

  type DataInput {
    boxId: String!
  }

  type Transaction {
    transactionId: String!
    timestamp: String!
    inclusionHeight: Int!
    headerId: String!
    index: Int!
    size: Int!
    inputs: [Input!]!
    dataInputs: [DataInput!]!
    outputs(relevantOnly: Boolean): [Box!]!
  }

  type Mempool {
    "Bytes of all pool transactions."
    size: Int!
    transactionsCount: Int!
    boxes(
      skip: Int = 0
      take: Int = 50
      boxId: String
      boxIds: [String!]
      transactionId: String
      address: String
      addresses: [String!]
      ergoTree: String
      ergoTrees: [String!]
      ergoTreeTemplateHash: String
      tokenId: String
    ): [Box!]!
    transactions(
      skip: Int = 0
      take: Int = 50
      transactionId: String
      transactionIds: [String!]
      address: String
      addresses: [String!]
    ): [Transaction!]!
  }

  input SignedTransaction {
    id: String!
    inputs: [TransactionInput!]!
    dataInputs: [TransactionDataInput!]
    outputs: [TransactionOutput!]!
    size: Int
  }

  input TransactionInput {
    boxId: String!
    spendingProof: SpendingProofInput!
  }

  input SpendingProofInput {
    proofBytes: String!
    extension: JSONObject!
  }

  input TransactionDataInput {
    boxId: String!
  }

  input TransactionOutput {
    boxId: String
    value: String!
    ergoTree: String!
    creationHeight: Int!
    assets: [AssetInput!]
    additionalRegisters: JSONObject!
    transactionId: String
    index: Int
  }

  input AssetInput {
    tokenId: String!
    amount: String!
  }
`;
