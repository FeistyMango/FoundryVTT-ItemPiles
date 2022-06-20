import "./styles/styles.scss";

import API from "./api.js";
import registerSettings from "./settings.js";
import Socket from "./socket.js";
import SettingsShim from "./applications/settings-interface/settings-app.js";
import CurrenciesEditor from "./applications/editors/currencies-editor/currencies-editor.js";
import ItemPileConfig from "./applications/item-pile-config/item-pile-config.js";
import { ItemPileInventory } from "./applications/item-pile-inventory-interface/item-pile-inventory.js";
import { registerHotkeysPost, registerHotkeysPre } from "./hotkeys.js";
import * as Utilities from "./helpers/utilities.js";
import { TradeRequestDialog } from "./applications/trade-dialogs/trade-dialogs.js";

Hooks.once("init", async () => {
  registerHotkeysPre();
  registerSettings();
  game.itempiles = API;
  window.ItemPiles = {
    API: API
  };
});

Hooks.once("ready", () => {
  Socket.initialize();
  registerHotkeysPost();
  setTimeout(() => {
    TradeRequestDialog.show({
      tradingUser: game.users.getName("Gamemaster"),
      tradingActor: game.actors.getName("Almighty Spark"),
      isPrivate: true
    });
  })
})

Hooks.on("reset-item-pile-settings", async () => {
  for (let setting of game.settings.storage.get("world").filter(setting => setting.data.key.includes('item-piles'))) {
    await setting.delete();
  }
})

Hooks.on("createItem", (doc) => Utilities.refreshAppsWithDocument(doc.parent, "refreshItems"));
Hooks.on("updateItem", (doc) => Utilities.refreshAppsWithDocument(doc.parent, "refreshItems"));
Hooks.on("deleteItem", (doc) => Utilities.refreshAppsWithDocument(doc.parent, "refreshItems"));
Hooks.on("updateActor", (doc) => Utilities.refreshAppsWithDocument(doc, "refreshAttributes"));
Hooks.on("deleteToken", (doc) => Utilities.refreshAppsWithDocument(doc, "refreshDeletedPile"));
Hooks.on("deleteActor", (doc) => Utilities.refreshAppsWithDocument(doc, "refreshDeletedPile"));