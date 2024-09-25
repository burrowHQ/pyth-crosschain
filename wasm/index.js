const wasm = import("./pkg/wasm.js");
wasm.then(wasm => {
  let priceDataDetail = JSON.parse(wasm.parse_data("504e41550100000000a0010000000001009413d3a7410df6584e7aea85fe427efe88c07c4943b31b6915a70db2874e1a555ab4540529c3273963cab928919640f2dcbfcbe6b17460057ac6d2f80f3280090066f1630f00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71000000000559724f0141555756000000000009ed7d8c00002710f7d0cefab2d0bd907aac07dcf955f0227a5939b502005500f9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b000005c188a502850000000070047d84fffffff80000000066f1630f0000000066f1630e000005c4f1c442600000000065d246360bc664c8b7c5526b91eb54c9f70df65a996dbf1059edc85b71165de894612ff61afd2ba0dc4e92fe640b93f42d64869cc9a6c111238cd52ceb022c4fb2cccbf6e05c6d22def3114e03c5d3ff4ccb1e33425b3c1ffea717022ab3ca09b2b12d1c94f58ea527dc1621a9f1018d46a6e78bdd01674498d4c1c113490b9347114aea2d389404b12ffb36a43ba535f28291df28747107498256776f60738a98f2889b533921c1eaa0928295ecc224caaf7f1c2a8142f83d03b7038cc1b7b16207c71d3f6aeceec6903a2e6a63ba59517cd8f00a5d384ded8067f130f8bfb6d9005500ecf553770d9b10965f8fb64771e93f5690a182edc32be4a3236e0caaa6e0581a0000000dce06d36e0000000001686ec2fffffff80000000066f1630f0000000066f1630e0000000dcb94a3f800000000016ade9e0b10a09d34b2bb1e21d37f8e4e53a1b985e9619a7d03d102c162a955344639cd2e80978885d84d0c03c9968a7bfe29b488da8b95fa394a79505a20ff999b063c48a0b45d4c2ed2de83a78e981ab50f400598c42cc7fa2c0aecd3b206a713a0cf51c3e9ae4edc1621a9f1018d46a6e78bdd01674498d4c1c113490b9347114aea2d389404b12ffb36a43ba535f28291df28747107498256776f60738a98f2889b533921c1eaa0928295ecc224caaf7f1c2a8142f83d03b7038cc1b7b16207c71d3f6aeceec6903a2e6a63ba59517cd8f00a5d384ded8067f130f8bfb6d9"));
  for (const priceInfo of priceDataDetail) {
    priceInfo.feed_id = Buffer.from(priceInfo.feed_id).toString('hex');
  }
  console.log(priceDataDetail)
})
