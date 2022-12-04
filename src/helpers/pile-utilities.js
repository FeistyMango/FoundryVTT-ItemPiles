import * as Utilities from "./utilities.js"
import CONSTANTS from "../constants/constants.js";
import * as Helpers from "./helpers.js";
import { SYSTEMS } from "../systems.js";
import { hotkeyState } from "../hotkeys.js";
import SETTINGS from "../constants/settings.js";

function getFlagData(inDocument, flag, defaults, existing = false) {
  const defaultFlags = foundry.utils.duplicate(defaults);
  const flags = existing || (getProperty(inDocument, flag) ?? {});
  const data = foundry.utils.duplicate(flags);
  return foundry.utils.mergeObject(defaultFlags, data);
}

export function getItemFlagData(item, data = false) {
  return getFlagData(Utilities.getDocument(item), CONSTANTS.FLAGS.ITEM, foundry.utils.deepClone(CONSTANTS.ITEM_DEFAULTS), data);
}

export function getActorFlagData(target, data = false) {
  return getFlagData(Utilities.getActor(target), CONSTANTS.FLAGS.PILE, foundry.utils.deepClone(CONSTANTS.PILE_DEFAULTS), data);
}

export function isValidItemPile(target, data = false) {
  const targetActor = Utilities.getActor(target);
  const pileData = getActorFlagData(targetActor, data);
  return targetActor && pileData?.enabled;
}

export function isItemPileContainer(target, data = false) {
  const targetActor = Utilities.getActor(target);
  const pileData = getActorFlagData(targetActor, data);
  return pileData?.enabled && pileData?.isContainer;
}

export function isItemPileMerchant(target, data = false) {
  const targetActor = Utilities.getActor(target);
  const pileData = getActorFlagData(targetActor, data);
  return pileData?.enabled && pileData?.isMerchant;
}

export function isItemPileClosed(target, data = false) {
  const targetActor = Utilities.getActor(target);
  const pileData = getActorFlagData(targetActor, data);
  if (!pileData?.enabled || !pileData?.isContainer) return false;
  return pileData.closed;
}

export function isItemPileLocked(target, data = false) {
  const targetActor = Utilities.getActor(target);
  const pileData = getActorFlagData(targetActor, data);
  if (!pileData?.enabled || !pileData?.isContainer) return false;
  return pileData.locked;
}

export function isItemPileEmpty(target) {

  const targetActor = Utilities.getActor(target);
  if (!targetActor) return false;

  const validItemPile = isValidItemPile(targetActor);
  if (!validItemPile) return false;

  const hasNoItems = getActorItems(targetActor).length === 0;
  const hasNoAttributes = getActorCurrencies(targetActor).length === 0;

  return validItemPile && hasNoItems && hasNoAttributes;

}

export function shouldItemPileBeDeleted(targetUuid) {

  const target = fromUuidSync(targetUuid);

  if (!(target instanceof TokenDocument)) return false;

  if (!isItemPileEmpty(target)) return false;

  const pileData = getActorFlagData(target);

  if (typeof pileData?.deleteWhenEmpty === "boolean") {
    return pileData?.deleteWhenEmpty;
  }

  return {
    "default": Helpers.getSetting("deleteEmptyPiles"), "true": true, "false": false
  }[pileData?.deleteWhenEmpty ?? "default"];

}

export function getActorItems(target, { itemFilters = false, getItemCurrencies = false } = {}) {
  const actor = Utilities.getActor(target);
  const actorItemFilters = itemFilters ? cleanItemFilters(itemFilters) : getItemFilters(actor);
  const currencies = getActorCurrencies(actor, { getAll: true }).map(entry => entry.id);
  return actor.items.filter(item => (getItemCurrencies || currencies.indexOf(item.id) === -1) && !isItemInvalid(item, actor, actorItemFilters));
}

export function getActorCurrencies(target, { forActor = false, currencyList = false, getAll = false } = {}) {

  const actor = Utilities.getActor(target);
  const actorItems = Array.from(actor.items);
  currencyList = currencyList || getCurrencyList(forActor || actor);
  let currencies = currencyList.map((currency, index) => {
    if (currency.type === "attribute") {
      return {
        ...currency,
        quantity: getProperty(actor, currency.data.path) ?? 0,
        path: currency.data.path,
        id: currency.data.path,
        index
      }
    }
    const item = Utilities.findSimilarItem(actorItems, currency.data.item);
    return {
      ...currency,
      quantity: item ? Utilities.getItemQuantity(item) : 0,
      id: item?.id || null,
      item,
      index
    }
  });
  if (!getAll) {
    currencies = currencies.filter(currency => currency.quantity);
  }
  return currencies;
}

export function getActorPrimaryCurrency(target) {
  const actor = Utilities.getActor(target);
  return getActorCurrencies(actor).find(currency => currency.primary);
}

export function getCurrencyList(target = false, pileData = false) {
  if (target) {
    const targetActor = Utilities.getActor(target);
    pileData = getActorFlagData(targetActor, pileData);
  }
  return (pileData.overrideCurrencies || game.itempiles.API.CURRENCIES).map(currency => {
    currency.name = game.i18n.localize(currency.name);
    return currency;
  });
}


export function getItemFilters(target, pileData = false) {
  if (!target) return cleanItemFilters(game.itempiles.API.ITEM_FILTERS);
  const targetActor = Utilities.getActor(target);
  pileData = getActorFlagData(targetActor, pileData);
  return isValidItemPile(targetActor, pileData) && pileData?.overrideItemFilters ? cleanItemFilters(pileData.overrideItemFilters) : cleanItemFilters(game.itempiles.API.ITEM_FILTERS);
}

export function cleanItemFilters(itemFilters) {
  return itemFilters ? foundry.utils.duplicate(itemFilters).map(filter => {
    filter.path = filter.path.trim();
    filter.filters = Array.isArray(filter.filters) ? filter.filters : filter.filters.split(',').map(string => string.trim());
    filter.filters = new Set(filter.filters)
    return filter;
  }) : [];
}

export function isItemInvalid(item, targetActor = false, itemFilters = false) {
  const pileItemFilters = itemFilters ? itemFilters : getItemFilters(targetActor)
  const itemData = item instanceof Item ? item.toObject() : item;
  for (const filter of pileItemFilters) {
    if (!hasProperty(itemData, filter.path)) continue;
    const attributeValue = getProperty(itemData, filter.path);
    if (filter.filters.has(attributeValue)) {
      return attributeValue;
    }
  }
  return false;
}

export async function checkItemType(item, {
  actor = false,
  errorText = "ITEM-PILES.Errors.DisallowedItemDrop",
  warningTitle = "ITEM-PILES.Dialogs.TypeWarning.Title",
  warningContent = "ITEM-PILES.Dialogs.TypeWarning.DropContent",
  runTransformer = true
} = {}) {

  const disallowedType = isItemInvalid(item, actor);
  if (disallowedType) {
    if (!game.user.isGM) {
      return Helpers.custom_warning(game.i18n.format(errorText, { type: disallowedType }), true)
    }

    if (SYSTEMS.DATA.ITEM_TRANSFORMER && runTransformer) {
      item = await SYSTEMS.DATA.ITEM_TRANSFORMER(item);
    }

    const newDisallowedType = isItemInvalid(item, actor);

    if (newDisallowedType && !hotkeyState.shiftDown) {
      const force = await Dialog.confirm({
        title: game.i18n.localize(warningTitle),
        content: `<p class="item-piles-dialog">${game.i18n.format(warningContent, { type: newDisallowedType })}</p>`,
        defaultYes: false
      });
      if (!force) {
        return false;
      }
    }
  } else {
    if (SYSTEMS.DATA.ITEM_TRANSFORMER && runTransformer) {
      item = await SYSTEMS.DATA.ITEM_TRANSFORMER(item);
    }
  }

  return item;

}

export function isItemCurrency(item, { target = false } = {}) {
  const actor = Utilities.getActor(target ? target : item.parent);
  const currencies = getActorCurrencies(actor, { getAll: true })
    .filter(currency => currency.type === "item")
    .map(item => item.data.item);
  return !!Utilities.findSimilarItem(currencies, item);
}


export function getItemPileTokenImage(token, {
  data = false,
  items = false,
  currencies = false
} = {}, overrideImage = null) {

  const pileDocument = Utilities.getDocument(token);

  const itemPileData = getActorFlagData(pileDocument, data);

  const originalImg = overrideImage ?? (pileDocument instanceof TokenDocument
      ? pileDocument.texture.src
      : pileDocument.prototypeToken.texture.src
  );

  if (!isValidItemPile(pileDocument)) return originalImg;

  items = items || getActorItems(pileDocument);
  currencies = currencies || getActorCurrencies(pileDocument);

  const numItems = items.length + currencies.length;

  let img = originalImg;

  if (itemPileData.isContainer) {

    img = itemPileData.lockedImage || itemPileData.closedImage || itemPileData.openedImage || itemPileData.emptyImage;

    if (itemPileData.locked && itemPileData.lockedImage) {
      img = itemPileData.lockedImage;
    } else if (itemPileData.closed && itemPileData.closedImage) {
      img = itemPileData.closedImage;
    } else if (itemPileData.emptyImage && isItemPileEmpty(pileDocument)) {
      img = itemPileData.emptyImage;
    } else if (itemPileData.openedImage) {
      img = itemPileData.openedImage;
    }

  } else if (itemPileData.displayOne && numItems === 1) {

    img = items.length > 0 ? items[0].img : currencies[0].img;

  } else if (itemPileData.displayOne && numItems > 1) {

    img = originalImg;

  }

  return img || originalImg;

}

export function getItemPileTokenScale(target, {
  data = false,
  items = false,
  currencies = false
} = {}, overrideScale = null) {

  const pileDocument = Utilities.getDocument(target);

  let itemPileData = getActorFlagData(pileDocument, data);

  const baseScale = overrideScale ?? (pileDocument instanceof TokenDocument
      ? pileDocument.texture.scaleX
      : pileDocument.prototypeToken.texture.scaleX
  );

  if (!isValidItemPile(pileDocument, itemPileData)) {
    return baseScale;
  }

  items = items || getActorItems(pileDocument);
  currencies = currencies || getActorCurrencies(pileDocument);

  const numItems = items.length + currencies.length;

  if (itemPileData.isContainer || !itemPileData.displayOne || !itemPileData.overrideSingleItemScale || numItems > 1 || numItems === 0) {
    return baseScale;
  }

  return itemPileData.singleItemScale;

}

export function getItemPileName(target, { data = false, items = false, currencies = false } = {}, overrideName = null) {

  const pileDocument = Utilities.getDocument(target);

  const itemPileData = getActorFlagData(pileDocument, data);

  let name = overrideName ?? (pileDocument instanceof TokenDocument ? pileDocument.name : pileDocument.prototypeToken.name);

  if (!isValidItemPile(pileDocument, itemPileData)) {
    return name;
  }

  items = items || getActorItems(pileDocument);
  currencies = currencies || getActorCurrencies(pileDocument);

  const numItems = items.length + currencies.length;

  if (itemPileData.isContainer || !itemPileData.displayOne || !itemPileData.showItemName || numItems > 1 || numItems === 0) {
    return name;
  }

  const item = items.length > 0 ? items[0] : currencies[0];

  return item.name;

}

export function shouldEvaluateChange(target, changes) {
  const flags = getActorFlagData(target, getProperty(changes, CONSTANTS.FLAGS.PILE) ?? {});
  if (!isValidItemPile(target, flags)) return false;
  return (flags.isContainer && (flags.closedImage || flags.emptyImage || flags.openedImage || flags.lockedImage))
    || flags.displayOne || flags.showItemName || flags.overrideSingleItemScale;
}

function getRelevantTokensAndActor(target) {

  const relevantDocument = Utilities.getDocument(target);

  let documentActor;
  let documentTokens = [];

  if (relevantDocument instanceof Actor) {
    documentActor = relevantDocument;
    if (relevantDocument.token) {
      documentTokens.push(relevantDocument?.token);
    } else {
      documentTokens = canvas.tokens.placeables.filter(token => token.document.actor === documentActor).map(token => token.document);
    }
  } else {
    documentActor = relevantDocument.actor;
    if (relevantDocument.isLinked) {
      documentTokens = canvas.tokens.placeables.filter(token => token.document.actor === documentActor).map(token => token.document);
    } else {
      documentTokens.push(relevantDocument);
    }
  }

  return [documentActor, documentTokens]

}

export async function updateItemPileData(target, flagData, tokenData) {

  if (!target) return;

  if (!flagData) flagData = getActorFlagData(target);
  if (!tokenData) tokenData = {};

  let [documentActor, documentTokens] = getRelevantTokensAndActor(target);

  const items = getActorItems(documentActor, { itemFilters: flagData.overrideItemFilters });
  const currencies = getActorCurrencies(documentActor, { currencyList: flagData.overrideCurrencies });

  const pileData = { data: flagData, items, currencies };

  const updates = documentTokens.map(tokenDocument => {
    const newTokenData = foundry.utils.mergeObject(tokenData, {
      "img": getItemPileTokenImage(tokenDocument, pileData, tokenData?.img),
      "scale": getItemPileTokenScale(tokenDocument, pileData, tokenData?.scale),
      "name": getItemPileName(tokenDocument, pileData, tokenData?.name),
    });
    const data = {
      "_id": tokenDocument.id, ...newTokenData
    };
    if (!foundry.utils.isEmpty(flagData)) {
      data[CONSTANTS.FLAGS.PILE] = flagData;
    }
    if (!tokenDocument.actorLink) {
      data["actorData." + CONSTANTS.FLAGS.PILE] = flagData;
      if (tokenDocument.actor === documentActor) {
        documentActor = false;
      }
    }
    return data;
  });

  if (canvas.scene && !foundry.utils.isEmpty(updates)) {
    await canvas.scene.updateEmbeddedDocuments("Token", updates);
  }

  if (!foundry.utils.isEmpty(flagData) && documentActor) {
    await documentActor.update({
      [CONSTANTS.FLAGS.PILE]: flagData,
      [`token.${CONSTANTS.FLAGS.PILE}`]: flagData
    });
  }

  return true;
}

export async function updateItemData(item, update) {
  const flagData = foundry.utils.mergeObject(getItemFlagData(item), update.flags ?? {});
  return item.update({
    ...update?.data ?? {},
    [CONSTANTS.FLAGS.ITEM]: flagData
  });
}

/* -------------------------- Merchant Methods ------------------------- */

export function getMerchantModifiersForActor(merchant, { item = false, actor = false, pileFlagData = false } = {}) {

  let {
    buyPriceModifier, sellPriceModifier, itemTypePriceModifiers, actorPriceModifiers
  } = getActorFlagData(merchant, pileFlagData);

  if (item) {
    const itemTypePriceModifier = itemTypePriceModifiers.find(priceData => priceData.type === item.type);
    if (itemTypePriceModifier) {
      buyPriceModifier = itemTypePriceModifier.override ? itemTypePriceModifier.buyPriceModifier : buyPriceModifier * itemTypePriceModifier.buyPriceModifier;
      sellPriceModifier = itemTypePriceModifier.override ? itemTypePriceModifier.sellPriceModifier : sellPriceModifier * itemTypePriceModifier.sellPriceModifier;
    }
  }

  if (actor && actorPriceModifiers) {
    const actorSpecificModifiers = actorPriceModifiers?.find(data => data.actorUuid === Utilities.getUuid(actor) || data.actor === actor.id);
    if (actorSpecificModifiers) {
      buyPriceModifier = actorSpecificModifiers.override ? actorSpecificModifiers.buyPriceModifier : buyPriceModifier * actorSpecificModifiers.buyPriceModifier;
      sellPriceModifier = actorSpecificModifiers.override ? actorSpecificModifiers.sellPriceModifier : sellPriceModifier * actorSpecificModifiers.sellPriceModifier;
    }
  }

  return {
    buyPriceModifier, sellPriceModifier
  }
}

function getSmallestExchangeRate(currencies) {
  return currencies.length > 1 ? Math.min(...currencies.map(currency => currency.exchangeRate)) : (Helpers.getSetting(SETTINGS.CURRENCY_DECIMAL_DIGITS) ?? 0.00001);
}

function getExchangeRateDecimals(smallestExchangeRate) {
  return smallestExchangeRate.toString().includes(".") ? smallestExchangeRate.toString().split(".")[1].length : 0;
}

function getPriceArray(totalCost, currencies) {

  const primaryCurrency = currencies.find(currency => currency.primary);

  if (currencies.length === 1) {
    return [{
      ...primaryCurrency,
      cost: totalCost,
      baseCost: totalCost,
      maxCurrencyCost: totalCost,
      string: primaryCurrency.abbreviation.replace('{#}', totalCost)
    }]
  }

  const smallestExchangeRate = getSmallestExchangeRate(currencies);
  const decimals = getExchangeRateDecimals(smallestExchangeRate);

  let fraction = Helpers.roundToDecimals(totalCost % 1, decimals);
  let cost = Math.round(totalCost - fraction);

  const prices = [];

  if (primaryCurrency.exchangeRate === smallestExchangeRate) {

    for (const currency of currencies) {

      const numCurrency = Math.floor(Helpers.roundToDecimals(fraction / currency.exchangeRate, decimals));

      fraction = Helpers.roundToDecimals(fraction - (numCurrency * currency.exchangeRate), decimals);

      prices.push({
        ...currency,
        cost: Math.round(numCurrency),
        baseCost: Math.round(numCurrency),
        maxCurrencyCost: Math.ceil(totalCost / currency.exchangeRate),
        string: currency.abbreviation.replace("{#}", numCurrency)
      });

    }

    return prices;

  }

  let skipPrimary = false;
  if (cost) {
    skipPrimary = true;
    prices.push({
      ...primaryCurrency,
      cost: cost,
      baseCost: cost,
      maxCurrencyCost: totalCost,
      string: primaryCurrency.abbreviation.replace('{#}', cost)
    });
  }

  for (const currency of currencies) {

    if (currency === primaryCurrency && skipPrimary) continue;

    const numCurrency = Math.floor(Helpers.roundToDecimals(fraction / currency.exchangeRate, decimals));

    fraction = Helpers.roundToDecimals(fraction - (numCurrency * currency.exchangeRate), decimals);

    prices.push({
      ...currency,
      cost: Math.round(numCurrency),
      baseCost: Math.round(numCurrency),
      maxCurrencyCost: Math.ceil(totalCost / currency.exchangeRate),
      string: currency.abbreviation.replace("{#}", numCurrency)
    });
  }

  prices.sort((a, b) => b.exchangeRate - a.exchangeRate);

  return prices;
}

export function getPriceFromString(str, currencyList = false) {

  if (!currencyList) {
    currencyList = getCurrencyList();
  }

  const currencies = foundry.utils.duplicate(currencyList)
    .map(currency => {
      currency.quantity = 0
      return currency;
    });

  const parts = str.split(" ");

  let overallCost = 0;
  for (const part of parts) {
    for (const currency of currencies) {

      const regexString = ` ?${currency.abbreviation.toLowerCase().replace("{#}", "(.*?)")} ?`
      const regex = new RegExp(regexString, "g");

      const results = [...part.toLowerCase().matchAll(regex)];

      for (const result of results) {
        const roll = new Roll(result[1]).evaluate({ async: false })
        currency.quantity = roll.total;
        if (roll.total !== Number(result[1])) {
          currency.roll = roll;
        }
        overallCost += roll.total / currency.exchangeRate;
      }
    }
  }

  if (overallCost === 0) {
    const roll = new Roll(str).evaluate({ async: false });
    if (roll.total) {
      const primaryCurrency = currencies.find(currency => currency.primary);
      primaryCurrency.quantity = roll.total;
      if (roll.total !== Number(str)) {
        primaryCurrency.roll = roll;
      }
      overallCost = roll.total;
    }
  }

  return { currencies, overallCost };

}

export function getItemPrices(item, {
  seller = false, buyer = false, sellerFlagData = false, buyerFlagData = false, itemFlagData = false, quantity = 1
} = {}) {

  let priceData = [];

  buyerFlagData = getActorFlagData(buyer, buyerFlagData);
  if (!buyerFlagData?.enabled || !buyerFlagData?.isMerchant) {
    buyerFlagData = false;
  }

  sellerFlagData = getActorFlagData(seller, sellerFlagData);
  if (!sellerFlagData?.enabled || !sellerFlagData?.isMerchant) {
    sellerFlagData = false;
  }

  itemFlagData = itemFlagData || getItemFlagData(item);

  let merchant = sellerFlagData ? seller : buyer;

  if (merchant === buyer && itemFlagData.cantBeSoldToMerchants) {
    priceData.push({
      free: false,
      basePrices: [],
      basePriceString: "",
      prices: [],
      priceString: "",
      totalCost: 0,
      baseCost: 0,
      primary: true,
      maxQuantity: 0,
      quantity
    })
    return priceData;
  }

  // Retrieve the item price modifiers
  let modifier = 1;
  if (sellerFlagData) {

    modifier = getMerchantModifiersForActor(seller, {
      item, actor: buyer, pileFlagData: sellerFlagData
    }).buyPriceModifier;

  } else if (buyerFlagData) {

    modifier = getMerchantModifiersForActor(buyer, {
      item, actor: seller, pileFlagData: buyerFlagData
    }).sellPriceModifier;

  }

  const disableNormalCost = itemFlagData.disableNormalCost && !sellerFlagData.onlyAcceptBasePrice;
  const hasOtherPrices = itemFlagData.prices.filter(priceGroup => priceGroup.length).length > 0;

  const currencyList = getCurrencyList(merchant);
  const currencies = getActorCurrencies(merchant, { currencyList, getAll: true });

  // In order to easily calculate an item's total worth, we can use the smallest exchange rate and convert all prices
  // to it, in order have a stable form of exchange calculation
  const smallestExchangeRate = getSmallestExchangeRate(currencyList);
  const decimals = getExchangeRateDecimals(smallestExchangeRate);

  let overallCost = Utilities.getItemCost(item);
  if (game.system.id === "pf2e") {
    const { copperValue } = new game.pf2e.Coins(overallCost.value);
    overallCost = copperValue / 100 / (overallCost.per ?? 1);
  } else if (typeof overallCost === "string" && isNaN(Number(overallCost))) {
    overallCost = getPriceFromString(overallCost, currencyList).overallCost;
  } else {
    overallCost = Number(overallCost);
  }

  if (itemFlagData?.free || (!disableNormalCost && (overallCost === 0 || overallCost < smallestExchangeRate) && !hasOtherPrices) || modifier <= 0) {
    priceData.push({
      free: true,
      basePrices: [],
      basePriceString: "",
      prices: [],
      priceString: "",
      totalCost: 0,
      baseCost: 0,
      primary: true,
      maxQuantity: Infinity,
      quantity
    })
    return priceData;
  }

  // !(itemFlagData.disableNormalCost || (merchant === buyer && sellerFlagData.onlyAcceptBasePrice)) &&

  // If the item does include its normal cost, we calculate that here
  if (overallCost >= smallestExchangeRate && (!itemFlagData.disableNormalCost || (merchant === buyer && buyerFlagData.onlyAcceptBasePrice))) {

    // Base prices is the displayed price, without quantity taken into account
    const baseCost = Helpers.roundToDecimals(overallCost * modifier, decimals);
    const basePrices = getPriceArray(baseCost, currencies);

    // Prices is the cost with the amount of quantity taken into account, which may change the number of the different
    // types of currencies it costs (eg, an item wouldn't cost 1 gold and 100 silver, it would cost 11 gold
    let totalCost = Helpers.roundToDecimals(overallCost * modifier * quantity, decimals);
    let prices = getPriceArray(totalCost, currencies);

    if (baseCost) {

      priceData.push({
        basePrices,
        basePriceString: basePrices.filter(price => price.cost).map(price => price.string).join(" "),
        prices,
        priceString: prices.filter(price => price.cost).map(price => price.string).join(" "),
        totalCost,
        baseCost,
        primary: true,
        maxQuantity: 0,
        quantity
      });

    }
  }

  // If the item has custom prices, we include them here
  if (itemFlagData.prices.length && !(merchant === buyer && buyerFlagData.onlyAcceptBasePrice)) {

    priceData = priceData.concat(itemFlagData.prices.map(priceGroup => {
      const prices = priceGroup.map(price => {
        const itemModifier = price.fixed ? 1 : modifier;
        const cost = Math.round(price.quantity * itemModifier * quantity);
        const baseCost = Math.round(price.quantity * itemModifier);
        price.name = game.i18n.localize(price.name);
        return {
          ...price,
          cost,
          baseCost,
          modifier: itemModifier,
          priceString: cost ? price.abbreviation.replace("{#}", cost) : "",
          basePriceString: baseCost ? price.abbreviation.replace("{#}", baseCost) : ""
        };
      });

      return {
        prices,
        priceString: prices.filter(price => price.priceString).map(price => price.priceString).join(" "),
        basePriceString: prices.filter(price => price.basePriceString).map(price => price.basePriceString).join(" "),
        maxQuantity: 0,
        quantity
      }
    }));
  }

  const buyerInfiniteCurrencies = buyerFlagData?.infiniteCurrencies;
  const buyerInfiniteQuantity = buyerFlagData?.infiniteQuantity;

  // If there's a buyer, we also calculate how many of the item the buyer can afford
  if (!buyer) return priceData;

  const recipientCurrencies = getActorCurrencies(buyer, { currencyList });
  const totalCurrencies = recipientCurrencies.map(currency => currency.quantity * currency.exchangeRate).reduce((acc, num) => acc + num, 0);

  // For each price group, check for properties and items and make sure that the actor can afford it
  for (const priceGroup of priceData) {
    priceGroup.maxQuantity = Infinity;
    if (priceGroup.baseCost !== undefined) {
      if (buyerInfiniteCurrencies) continue;
      priceGroup.maxQuantity = Math.floor(totalCurrencies / priceGroup.baseCost);
      priceGroup.prices.forEach(price => {
        price.maxQuantity = priceGroup.maxQuantity;
      });
    } else {
      if (buyerInfiniteQuantity) continue;
      for (const price of priceGroup.prices) {
        if (price.type === "attribute") {
          const attributeQuantity = Number(getProperty(buyer, price.data.path));
          price.buyerQuantity = attributeQuantity;

          if (price.percent) {
            const percent = Math.min(1, price.baseCost / 100);
            const percentQuantity = Math.max(0, Math.floor(attributeQuantity * percent));
            price.maxQuantity = Math.floor(attributeQuantity / percentQuantity);
            price.baseCost = !buyer ? price.baseCost : percentQuantity;
            price.cost = !buyer ? price.cost : percentQuantity * quantity;
            price.quantity = !buyer ? price.quantity : percentQuantity;
          } else {
            price.maxQuantity = Math.floor(attributeQuantity / price.baseCost);
          }

          priceGroup.maxQuantity = Math.min(priceGroup.maxQuantity, price.maxQuantity)

        } else {
          const foundItem = Utilities.findSimilarItem(buyer.items, price.data.item);
          const itemQuantity = foundItem ? Utilities.getItemQuantity(foundItem) : 0;
          price.buyerQuantity = itemQuantity;

          if (price.percent) {
            const percent = Math.min(1, price.baseCost / 100);
            const percentQuantity = Math.max(0, Math.floor(itemQuantity * percent));
            price.maxQuantity = Math.floor(itemQuantity / percentQuantity);
            price.baseCost = !buyer ? price.baseCost : percentQuantity;
            price.cost = !buyer ? price.cost : percentQuantity * quantity;
            price.quantity = !buyer ? price.quantity : percentQuantity;
          } else {
            price.maxQuantity = Math.floor(itemQuantity / price.baseCost);
          }

          priceGroup.maxQuantity = Math.min(priceGroup.maxQuantity, price.maxQuantity);
        }
      }
    }
  }

  return priceData;
}

export function getPricesForItems(itemsToBuy, {
  seller = false, buyer = false, sellerFlagData = false, buyerFlagData = false
} = {}) {

  sellerFlagData = getActorFlagData(seller, sellerFlagData);
  if (!sellerFlagData?.enabled || !sellerFlagData?.isMerchant) {
    sellerFlagData = false;
  }

  buyerFlagData = getActorFlagData(buyer, buyerFlagData);
  if (!buyerFlagData?.enabled || !buyerFlagData?.isMerchant) {
    buyerFlagData = false;
  }

  const merchant = sellerFlagData ? seller : buyer;
  const currencyList = getCurrencyList(merchant);
  const currencies = getActorCurrencies(merchant, { currencyList, getAll: true });
  const smallestExchangeRate = getSmallestExchangeRate(currencies)
  const decimals = getExchangeRateDecimals(smallestExchangeRate);

  const recipientCurrencies = getActorCurrencies(buyer, { currencyList, getAll: true });

  const buyerInfiniteCurrencies = buyerFlagData?.infiniteCurrencies;

  const paymentData = itemsToBuy.map(data => {
      const prices = getItemPrices(data.item, {
        seller, buyer, sellerFlagData, buyerFlagData, itemFlagData: data.itemFlagData, quantity: data.quantity || 1
      })[data.paymentIndex || 0];
      return {
        ...prices, item: data.item
      };
    })
    .reduce((priceData, priceGroup) => {

      if (!priceGroup.maxQuantity) return priceData;

      if (priceGroup.primary) {

        priceData.totalCurrencyCost = Helpers.roundToDecimals(priceData.totalCurrencyCost + priceGroup.totalCost, decimals);
        priceData.primary = true;

      } else {

        for (const price of priceGroup.prices) {

          let existingPrice = priceData.otherPrices.find(otherPrice => {
            return otherPrice.id === price.id || (otherPrice.name === price.name && otherPrice.img === price.img && otherPrice.type === price.type);
          });

          if (existingPrice) {
            existingPrice.cost += price.cost;
          } else {
            const index = priceData.otherPrices.push(price);
            existingPrice = priceData.otherPrices[index - 1];
            existingPrice.quantity = 0;
          }

          existingPrice.quantity += price.cost;
          existingPrice.buyerQuantity -= price.cost;

          if (existingPrice.buyerQuantity < 0) {
            priceData.canBuy = false;
          }
        }
      }

      priceData.buyerReceive.push({
        type: "item",
        name: priceGroup.item.name,
        img: priceGroup.item.img,
        quantity: priceGroup.quantity,
        item: priceGroup.item,
      });

      return priceData;

    }, {
      totalCurrencyCost: 0, canBuy: true, primary: false, finalPrices: [], otherPrices: [],

      buyerReceive: [], buyerChange: [], sellerReceive: []
    });

  if (paymentData.totalCurrencyCost) {

    // The price array that we need to fill
    const prices = getPriceArray(paymentData.totalCurrencyCost, recipientCurrencies);

    // This is the target price amount we need to hit
    let priceLeft = paymentData.totalCurrencyCost;

    // Starting from the smallest currency increment in the price
    for (let i = prices.length - 1; i >= 0; i--) {

      const price = prices[i];

      const buyerPrice = {
        ...price,
        buyerQuantity: buyerInfiniteCurrencies ? Infinity : price.quantity,
        quantity: 0,
        isCurrency: true
      }

      if (price.type === "item") {
        buyerPrice.item = price.data.item;
      }

      // If we have met the price target (or exceeded it, eg, we need change), populate empty entry
      if (priceLeft <= 0 || !price.cost || currencies.length === 1) {
        if (currencies.length === 1) {
          buyerPrice.quantity = price.cost;
          priceLeft = 0;
        }
        paymentData.finalPrices.push(buyerPrice);
        continue;
      }

      // If the buyer does not have enough to cover the cost, put what we can into it, otherwise all of it
      buyerPrice.quantity = buyerPrice.buyerQuantity < price.cost ? buyerPrice.buyerQuantity : price.cost;

      // If it's the primary currency
      if (price.primary) {
        // And the buyer has enough of the primary currency to cover the rest of the price, use that
        const totalCurrencyValue = Helpers.roundToDecimals(buyerPrice.buyerQuantity * price.exchangeRate, decimals);
        if (totalCurrencyValue > priceLeft) {
          buyerPrice.quantity = Math.ceil(priceLeft);
        }
      }

      paymentData.finalPrices.push(buyerPrice);

      // Then adjust the remaining price - if this goes below zero, we will need change back
      priceLeft = Helpers.roundToDecimals(priceLeft - (buyerPrice.quantity * price.exchangeRate), decimals);

    }

    // If there's STILL some remaining price (eg, we haven't been able to scrounge up enough currency to pay for it)
    // we can start using the larger currencies, such as platinum in D&D 5e
    if (currencies.length > 1) {
      while (priceLeft > 0) {

        // We then need to loop through each price, and check if we have any more left over
        for (const buyerPrice of paymentData.finalPrices) {

          // If we don't, look for the next one
          let buyerCurrencyQuantity = buyerPrice.buyerQuantity - buyerPrice.quantity;
          if (!buyerCurrencyQuantity) continue;

          // Otherwise, add enough to cover the remaining cost
          const newQuantity = Math.ceil(Math.min(buyerCurrencyQuantity, priceLeft / buyerPrice.exchangeRate));
          buyerPrice.quantity += newQuantity;
          priceLeft = Helpers.roundToDecimals(priceLeft - (newQuantity * buyerPrice.exchangeRate), decimals);

          if (priceLeft <= 0) break;

        }

        if (priceLeft > 0) {
          paymentData.finalPrices = paymentData.finalPrices.sort((a, b) => b.exchangeRate - a.exchangeRate);
        } else {
          break;
        }
      }

      paymentData.finalPrices = paymentData.finalPrices.sort((a, b) => b.exchangeRate - a.exchangeRate);

      // Since the change will be negative, we'll need to flip it, since this is what we'll get back
      let change = Math.abs(priceLeft);
      for (const currency of currencies) {

        if (!change) break;

        // Get the remaining price, and normalize it to this currency
        let numCurrency = Math.floor(Helpers.roundToDecimals(change / currency.exchangeRate, decimals));
        change = Helpers.roundToDecimals(change - (numCurrency * currency.exchangeRate), decimals);

        // If there's some currencies to be gotten back
        if (numCurrency) {
          // We check if we've paid with this currency
          const payment = paymentData.finalPrices.find(payment => {
            return payment.id === currency.id || (payment.name === currency.name && payment.img === currency.img && payment.type === currency.type);
          });
          if (!payment) continue;

          // If we have paid with this currency, and we're getting some back, we can do one of two things:
          if ((payment.quantity - numCurrency) >= 0) {
            // Either just subtract it from the total paid if some of our payment will still remain
            // IE, the change we got back didn't cancel out the payment
            payment.quantity -= numCurrency;
          } else {
            // Or if it does cancel out our payment, we add that to the change we'll get back and remove the payment entirely
            paymentData.buyerChange.push({
              ...currency, isCurrency: true, quantity: numCurrency - payment.quantity
            });
            payment.quantity = 0;
          }
        }
      }
    }

    // Copy the final currencies that the seller will get
    paymentData.sellerReceive = paymentData.finalPrices.map(price => {
      return { ...price };
    });

    // But, we'll need to make sure they have enough change to _give_ to the buyer
    // We collate the total amount of change needed
    let changeNeeded = paymentData.buyerChange.reduce((acc, change) => {
      const currency = currencies.find(currency => {
        return change.id === currency.id || (change.name === currency.name && change.img === currency.img && change.type === currency.type);
      });
      return acc + currency.quantity >= change.quantity ? 0 : (change.quantity - currency.quantity) * change.exchangeRate;
    }, 0);

    // If the seller needs give the buyer some change, we'll modify the payment they'll get to cover for it
    if (changeNeeded) {

      // If the seller is being given enough of the primary currency to cover for the cost, we use that
      const primaryCurrency = paymentData.sellerReceive.find(price => price.primary && (price.quantity * price.exchangeRate) > changeNeeded);
      if (primaryCurrency) {
        primaryCurrency.quantity--;
        changeNeeded -= 1 * primaryCurrency.exchangeRate;
      } else {
        // Otherwise, we'll use the biggest currency we can find to cover for it
        const biggestCurrency = paymentData.sellerReceive.find(price => price.quantity && (price.quantity * price.exchangeRate) > changeNeeded);
        biggestCurrency.quantity--;
        changeNeeded -= 1 * biggestCurrency.exchangeRate;
      }

      changeNeeded = Math.abs(changeNeeded);

      // Then loop through each currency and add enough currency so that the total adds up
      for (const currency of paymentData.sellerReceive) {
        if (!changeNeeded) break;
        let numCurrency = Math.floor(Helpers.roundToDecimals(changeNeeded / currency.exchangeRate, decimals));
        changeNeeded = Helpers.roundToDecimals(changeNeeded - (numCurrency * currency.exchangeRate), decimals);
        currency.quantity += numCurrency;
      }
    }
  }

  paymentData.finalPrices = paymentData.finalPrices.concat(paymentData.otherPrices);
  paymentData.sellerReceive = paymentData.sellerReceive.concat(paymentData.otherPrices);

  paymentData.basePriceString = paymentData.finalPrices
    .filter(price => price.cost)
    .map(price => {
      let abbreviation = price.abbreviation;
      if (price.percent && abbreviation.includes("%")) {
        abbreviation = abbreviation.replaceAll("%", "")
      }
      return abbreviation.replace("{#}", price.cost)
    }).join(" ");

  delete paymentData.otherPrices;

  return paymentData;

}
