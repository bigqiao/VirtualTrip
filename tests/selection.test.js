import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseReference,
  clothingGuidance,
  chooseIdentityReferences,
  allocateReferenceBudget,
  selectionUsesPhoto,
} from "../server/selection.js";
const summer = {
  id: "summer",
  analysis: {
    hasPerson: true,
    temperatureMin: 23,
    temperatureMax: 36,
    identityQuality: 0.9,
  },
};
const winter = {
  id: "winter",
  analysis: {
    hasPerson: true,
    temperatureMin: -12,
    temperatureMax: 8,
    identityQuality: 0.8,
  },
};
test("cold destinations never automatically select a summer outfit when a winter reference exists", () => {
  const result = chooseReference([summer, winter], { temperature: -5 });
  assert.equal(result.photo.id, "winter");
  assert.equal(result.adapt, false);
});
test("when only summer clothing exists, preserve identity and change clothing for cold weather", () => {
  const result = chooseReference([summer], { temperature: -8 });
  assert.equal(result.adapt, true);
  assert.match(clothingGuidance(-8), /NO summer outfit/);
});
test("manual summer reference overrides cold weather", () => {
  const result = chooseReference([summer, winter], {
    temperature: -8,
    overridePhotoId: "summer",
  });
  assert.equal(result.photo.id, "summer");
  assert.equal(result.manual, true);
  assert.equal(result.adapt, false);
});
test("manual clothing text overrides automatic matching", () => {
  const result = chooseReference([summer], {
    temperature: -8,
    overrideOutfit: "一定穿白色短袖",
  });
  assert.equal(result.manual, true);
  assert.equal(result.adapt, true);
});
test("unknown weather does not pretend a reference outfit is appropriate", () => {
  for (const temperature of [null, undefined, NaN]) {
    const result = chooseReference([summer], { temperature });
    assert.equal(result.adapt, true);
    assert.match(clothingGuidance(temperature), /unknown/);
  }
});
test("invalid or deleted manual photo never silently falls back", () => {
  assert.throws(() =>
    chooseReference([summer], { temperature: 0, overridePhotoId: "deleted" }),
  );
  assert.throws(() => chooseReference([], { temperature: 0 }));
});

test("clearest face leads, clothing image follows, extras ranked by face visibility", () => {
  const clearerSummer = {
    ...summer,
    id: "face",
    analysis: { ...summer.analysis, identityQuality: 0.99 },
  };
  const refs = chooseIdentityReferences(
    [summer, winter, clearerSummer, summer],
    winter,
  );
  assert.deepEqual(
    refs.map((p) => p.id),
    ["face", "winter", "summer"],
  );
});
test("clothing image stays first when it already has the clearest face", () => {
  assert.deepEqual(
    chooseIdentityReferences([summer, winter], summer).map((p) => p.id),
    ["summer", "winter"],
  );
});
test("few photos do not lead to duplicate references or invented images", () => {
  assert.deepEqual(
    chooseIdentityReferences([summer, summer], summer).map((p) => p.id),
    ["summer"],
  );
});
test("manual and unknown-weather identity references prefer clear faces instead of newest image", () => {
  assert.equal(
    chooseReference([winter, summer], { temperature: null }).photo.id,
    "summer",
  );
  assert.equal(
    chooseReference([winter, summer], {
      temperature: -8,
      overrideOutfit: "白色短袖",
    }).photo.id,
    "summer",
  );
});
test("six travelers each receive extra identity support within the image budget", () => {
  const people = Array.from({ length: 6 }, (_, i) => ({
    photoId: `${i}-0`,
    references: Array.from({ length: 3 }, (_, j) => ({ photoId: `${i}-${j}` })),
  }));
  for (const budget of [15, 16]) {
    const assigned = allocateReferenceBudget(people, budget);
    assert.equal(
      assigned.reduce((sum, p) => sum + p.references.length, 0),
      budget,
    );
    assert.ok(
      assigned.every(
        (p) => p.references.length >= 2 && p.references.length <= 3,
      ),
    );
    assert.ok(assigned.every((p, i) => p.references[0].photoId === `${i}-0`));
  }
  assert.equal(people[0].references.length, 3);
});
test("deletion protection covers supplementary photos and old single-reference plans", () => {
  assert.equal(
    selectionUsesPhoto(
      {
        photoId: "primary",
        references: [{ photoId: "primary" }, { photoId: "extra" }],
      },
      "extra",
    ),
    true,
  );
  assert.equal(selectionUsesPhoto({ photoId: "primary" }, "primary"), true);
  assert.equal(selectionUsesPhoto({ photoId: "primary" }, "other"), false);
});
