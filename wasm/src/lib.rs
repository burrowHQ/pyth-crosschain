extern crate wasm_bindgen;
use wasm_bindgen::prelude::wasm_bindgen;
use std::io::Cursor;
use pythnet_sdk::{
    messages::Message,
    wire::{
        from_slice,
        v1::{
            AccumulatorUpdateData,
            Proof,
        },
    },
};

#[wasm_bindgen]
pub fn parse_latest_vaas(data_hex: &str) -> String {
    let bytes = hex::decode(data_hex).unwrap();
    let cursor = &mut Cursor::new(bytes);
    let update_data =
        AccumulatorUpdateData::try_from_slice(&cursor.clone().into_inner()).unwrap();
    let mut prices = vec![];
    match update_data.proof {
        Proof::WormholeMerkle { updates, .. } => {
            for update in updates {
                let message_vec = Vec::from(update.message);
                let msg = match from_slice::<byteorder::BE, Message>(&message_vec) {
                    Ok(msg) => msg,
                    Err(_) => return "InvalidAccumulatorMessage".to_string()
                };
                match msg {
                    Message::PriceFeedMessage(price_feed_message) => {
                        prices.push(price_feed_message);
                    }
                    _ => return "InvalidAccumulatorMessageType".to_string()
                }
            }
        }
    }
    serde_json::to_string(&prices).unwrap()
}
