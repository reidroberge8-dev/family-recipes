import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  session: null,
  recipes: [],
  ingredients: [],
  subRecipes: [],
  grocery: [],
  view: { tab: "recipes", mode: "list", recipeId: null, editingId: null },
  formDraft: null, // { name, servings, instructions, ingredients:[], subRecipeIds:[] }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function openModal({ title, bodyHtml, footerHtml, onMount }) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-sheet">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" id="modal-close-btn">&times;</button>
        </div>
        <div id="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="action-row" id="modal-footer">${footerHtml}</div>` : ""}
      </div>
    </div>`;
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  $("#modal-close-btn").addEventListener("click", closeModal);
  if (onMount) onMount(root);
}
function closeModal() {
  $("#modal-root").innerHTML = "";
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadAll() {
  const [recipesRes, ingRes, subRes, groceryRes] = await Promise.all([
    supabase.from("recipes").select("*").order("name"),
    supabase.from("recipe_ingredients").select("*").order("sort_order"),
    supabase.from("sub_recipes").select("*").order("sort_order"),
    supabase.from("grocery_items").select("*").order("created_at", { ascending: false }),
  ]);
  if (recipesRes.error) { toast("Could not load recipes: " + recipesRes.error.message); return; }
  state.recipes = recipesRes.data || [];
  state.ingredients = ingRes.data || [];
  state.subRecipes = subRes.data || [];
  state.grocery = groceryRes.data || [];
  render();
}

function recipeById(id) { return state.recipes.find((r) => r.id === id); }
function ingredientsFor(recipeId) { return state.ingredients.filter((i) => i.recipe_id === recipeId); }
function childrenOf(parentId) {
  return state.subRecipes
    .filter((s) => s.parent_recipe_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => s.child_recipe_id);
}
function parentsOf(childId) {
  return state.subRecipes.filter((s) => s.child_recipe_id === childId).map((s) => s.parent_recipe_id);
}

// All descendant recipe ids reachable downward from recipeId (not including itself)
function descendantsOf(recipeId, visited = new Set()) {
  if (visited.has(recipeId)) return visited;
  visited.add(recipeId);
  for (const childId of childrenOf(recipeId)) descendantsOf(childId, visited);
  return visited;
}

// Flattened shopping ingredients: own + every sub-recipe, recursively. Cycle-safe.
function flattenIngredients(recipeId, visited = new Set()) {
  if (visited.has(recipeId)) return [];
  const nextVisited = new Set(visited);
  nextVisited.add(recipeId);
  const r = recipeById(recipeId);
  const rows = ingredientsFor(recipeId).map((i) => ({
    description: i.description,
    amount: i.amount || "",
    fromRecipeName: r ? r.name : "",
  }));
  for (const childId of childrenOf(recipeId)) {
    rows.push(...flattenIngredients(childId, nextVisited));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------
let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadAll, 250);
}

function initRealtime() {
  supabase
    .channel("db-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "recipe_ingredients" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "sub_recipes" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "grocery_items" }, scheduleReload)
    .subscribe();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function initAuth() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  showScreenForSession();

  supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    showScreenForSession();
  });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    $("#login-error").classList.add("hidden");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      $("#login-error").textContent = error.message;
      $("#login-error").classList.remove("hidden");
    }
  });

  $("#signout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}

function showScreenForSession() {
  if (state.session) {
    $("#login-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    loadAll();
  } else {
    $("#app").classList.add("hidden");
    $("#login-screen").classList.remove("hidden");
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function goTab(tab) {
  state.view = { tab, mode: "list", recipeId: null, editingId: null };
  render();
}
function goDetail(recipeId) {
  state.view = { tab: "recipes", mode: "detail", recipeId, editingId: null };
  render();
}
function goForm(editingId) {
  const existing = editingId ? recipeById(editingId) : null;
  state.formDraft = existing
    ? {
        name: existing.name,
        servings: existing.servings || "",
        instructions: existing.instructions || "",
        ingredients: ingredientsFor(existing.id).map((i) => ({ localId: uid(), description: i.description, amount: i.amount || "" })),
        subRecipeIds: childrenOf(existing.id).slice(),
      }
    : { name: "", servings: "", instructions: "", ingredients: [{ localId: uid(), description: "", amount: "" }], subRecipeIds: [] };
  state.view = { tab: "recipes", mode: "form", recipeId: null, editingId };
  render();
}

$("#nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-btn");
  if (btn) goTab(btn.dataset.tab);
});
$("#back-btn").addEventListener("click", () => {
  if (state.view.mode === "form" && state.view.editingId) {
    goDetail(state.view.editingId);
  } else {
    goTab(state.view.tab);
  }
});

// ---------------------------------------------------------------------------
// Render dispatcher
// ---------------------------------------------------------------------------
function render() {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.view.tab));
  $("#back-btn").classList.toggle("hidden", state.view.mode === "list");

  const uncheckedCount = state.grocery.filter((g) => !g.is_checked).length;
  const badge = $("#grocery-badge");
  badge.textContent = String(uncheckedCount);
  badge.classList.toggle("hidden", uncheckedCount === 0);

  if (state.view.tab === "recipes") {
    if (state.view.mode === "list") { $("#header-title").textContent = "Recipes"; renderRecipeList(); }
    else if (state.view.mode === "detail") { renderRecipeDetail(); }
    else if (state.view.mode === "form") { renderRecipeForm(); }
  } else {
    $("#header-title").textContent = "Grocery List";
    renderGrocery();
  }
}

// ---------------------------------------------------------------------------
// Recipes: list
// ---------------------------------------------------------------------------
function renderRecipeList() {
  const content = $("#content");
  const query = (state._recipeSearch || "").toLowerCase();
  const list = state.recipes.filter((r) => r.name.toLowerCase().includes(query));

  content.innerHTML = `
    <input type="text" class="search-bar" id="recipe-search" placeholder="Search recipes..." value="${escapeAttr(state._recipeSearch || "")}" />
    <div id="recipe-list-items"></div>
    <button class="fab" id="add-recipe-fab" title="Add recipe">+</button>
  `;

  const itemsEl = $("#recipe-list-items");
  if (list.length === 0) {
    itemsEl.innerHTML = `<div class="empty-state">${state.recipes.length === 0 ? "No recipes yet. Tap + to add your first one." : "No recipes match your search."}</div>`;
  } else {
    itemsEl.innerHTML = list
      .map((r) => {
        const subCount = childrenOf(r.id).length;
        const ingCount = ingredientsFor(r.id).length;
        const meta = [`${ingCount} ingredient${ingCount === 1 ? "" : "s"}`];
        if (subCount) meta.push(`${subCount} sub-recipe${subCount === 1 ? "" : "s"}`);
        return `
          <div class="card recipe-card" data-id="${r.id}">
            <div>
              <div class="r-name">${escapeHtml(r.name)}</div>
              <div class="r-meta">${meta.join(" · ")}${r.servings ? " · " + escapeHtml(r.servings) : ""}</div>
            </div>
            <button class="icon-btn cart-quick" data-id="${r.id}" title="Add to grocery list">🛒</button>
          </div>`;
      })
      .join("");
  }

  $("#recipe-search").addEventListener("input", (e) => {
    state._recipeSearch = e.target.value;
    renderRecipeList();
    $("#recipe-search").focus();
    const v = $("#recipe-search").value;
    $("#recipe-search").value = v;
    $("#recipe-search").setSelectionRange(v.length, v.length);
  });
  $("#add-recipe-fab").addEventListener("click", () => goForm(null));
  $$(".recipe-card", itemsEl).forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".cart-quick")) return;
      goDetail(card.dataset.id);
    });
  });
  $$(".cart-quick", itemsEl).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openAddToGroceryModal(btn.dataset.id);
    });
  });
}

// ---------------------------------------------------------------------------
// Recipes: detail
// ---------------------------------------------------------------------------
function renderRecipeTreeHtml(recipeId, visited, depth) {
  if (visited.has(recipeId)) return "";
  const next = new Set(visited);
  next.add(recipeId);
  const r = recipeById(recipeId);
  if (!r) return "";
  const ings = ingredientsFor(recipeId);
  const kids = childrenOf(recipeId);
  const ingHtml = ings
    .map((i) => `<div class="ingredient-row"><span class="desc">${escapeHtml(i.description)}</span><span class="amt">${escapeHtml(i.amount || "")}</span></div>`)
    .join("");
  const kidsHtml = kids.map((cid) => renderRecipeTreeHtml(cid, next, depth + 1)).join("");
  return `
    <div class="sub-recipe-block">
      <div class="sr-title">${depth === 0 ? "" : "🔁 "}${escapeHtml(r.name)}</div>
      ${ingHtml || '<div class="muted" style="font-size:13px;">No ingredients listed.</div>'}
      ${kidsHtml}
    </div>`;
}

function renderRecipeDetail() {
  const r = recipeById(state.view.recipeId);
  const content = $("#content");
  if (!r) { content.innerHTML = `<div class="empty-state">Recipe not found.</div>`; return; }
  $("#header-title").textContent = r.name;

  const ownIngredients = ingredientsFor(r.id);
  const kids = childrenOf(r.id);

  const ingHtml = ownIngredients
    .map((i) => `<div class="ingredient-row"><span class="desc">${escapeHtml(i.description)}</span><span class="amt">${escapeHtml(i.amount || "")}</span></div>`)
    .join("");

  const subHtml = kids.map((cid) => renderRecipeTreeHtml(cid, new Set([r.id]), 1)).join("");

  content.innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(r.name)}</h2>
    </div>
    ${r.servings ? `<div class="muted" style="margin-bottom:8px;">Servings: ${escapeHtml(r.servings)}</div>` : ""}

    <div class="section-title">Ingredients</div>
    <div class="card">${ingHtml || '<div class="muted">No ingredients listed yet.</div>'}</div>

    ${kids.length ? `<div class="section-title">Sub-Recipes Included</div><div class="card">${subHtml}</div>` : ""}

    ${r.instructions ? `<div class="section-title">Instructions</div><div class="card instructions-block">${escapeHtml(r.instructions)}</div>` : ""}

    <div class="action-row">
      <button class="btn primary" id="add-to-grocery-btn">🛒 Add to Grocery List</button>
      <button class="btn" id="edit-recipe-btn">Edit</button>
      <button class="btn danger" id="delete-recipe-btn">Delete</button>
    </div>
  `;

  $("#add-to-grocery-btn").addEventListener("click", () => openAddToGroceryModal(r.id));
  $("#edit-recipe-btn").addEventListener("click", () => goForm(r.id));
  $("#delete-recipe-btn").addEventListener("click", () => confirmDeleteRecipe(r));
}

function confirmDeleteRecipe(r) {
  const usedIn = parentsOf(r.id).map((pid) => recipeById(pid)?.name).filter(Boolean);
  openModal({
    title: "Delete recipe?",
    bodyHtml: `
      <p>Delete <strong>${escapeHtml(r.name)}</strong>? This also removes its ingredients.</p>
      ${usedIn.length ? `<p class="error">This is used as a sub-recipe in: ${usedIn.map(escapeHtml).join(", ")}. Deleting it will remove it from those recipes too.</p>` : ""}
    `,
    footerHtml: `<button class="btn" id="cancel-del">Cancel</button><button class="btn danger" id="confirm-del">Delete</button>`,
    onMount: () => {
      $("#cancel-del").addEventListener("click", closeModal);
      $("#confirm-del").addEventListener("click", async () => {
        const { error } = await supabase.from("recipes").delete().eq("id", r.id);
        closeModal();
        if (error) { toast("Delete failed: " + error.message); return; }
        toast(`Deleted "${r.name}"`);
        goTab("recipes");
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Recipes: add/edit form
// ---------------------------------------------------------------------------
function renderRecipeForm() {
  const draft = state.formDraft;
  const isEdit = !!state.view.editingId;
  $("#header-title").textContent = isEdit ? "Edit Recipe" : "New Recipe";
  const content = $("#content");

  const ingRowsHtml = draft.ingredients
    .map(
      (ing) => `
      <div class="ing-row" data-local-id="${ing.localId}">
        <input class="desc" placeholder="Ingredient (e.g. chicken breast)" value="${escapeAttr(ing.description)}" />
        <input class="amt" placeholder="Amount (e.g. 2 lbs)" value="${escapeAttr(ing.amount)}" />
        <button class="rm" title="Remove">&times;</button>
      </div>`
    )
    .join("");

  const chipsHtml = draft.subRecipeIds
    .map((id) => {
      const r = recipeById(id);
      return `<span class="chip removable" data-id="${id}">${escapeHtml(r ? r.name : "?")}<span class="x">&times;</span></span>`;
    })
    .join("");

  content.innerHTML = `
    <div class="form-group">
      <label>Recipe Name</label>
      <input type="text" id="f-name" value="${escapeAttr(draft.name)}" placeholder="e.g. Chicken Parmesan" />
    </div>
    <div class="form-group">
      <label>Servings (optional)</label>
      <input type="text" id="f-servings" value="${escapeAttr(draft.servings)}" placeholder="e.g. 4 servings" />
    </div>

    <div class="section-title">Ingredients</div>
    <div id="ing-rows">${ingRowsHtml}</div>
    <button class="btn sm" id="add-ing-row">+ Add Ingredient</button>

    <div class="section-title">Sub-Recipes</div>
    <p class="have-it-hint">Add an existing recipe as a component (e.g. add "Chicken Cutlets" into "Chicken Parmesan"). Its ingredients and instructions come along automatically.</p>
    <div class="autocomplete-wrap">
      <input type="text" id="f-subrecipe-search" placeholder="Search recipes to add as a sub-recipe..." />
      <div id="f-subrecipe-list" class="autocomplete-list hidden"></div>
    </div>
    <div id="f-subrecipe-chips" style="margin-top:8px;">${chipsHtml}</div>

    <div class="form-group" style="margin-top:18px;">
      <label>Instructions</label>
      <textarea id="f-instructions" placeholder="Step by step...">${escapeHtml(draft.instructions)}</textarea>
    </div>

    <div class="action-row">
      <button class="btn primary" id="save-recipe-btn">Save Recipe</button>
      <button class="btn" id="cancel-form-btn">Cancel</button>
    </div>
  `;

  $("#f-name").addEventListener("input", (e) => (draft.name = e.target.value));
  $("#f-servings").addEventListener("input", (e) => (draft.servings = e.target.value));
  $("#f-instructions").addEventListener("input", (e) => (draft.instructions = e.target.value));

  bindIngredientRows();
  $("#add-ing-row").addEventListener("click", () => {
    draft.ingredients.push({ localId: uid(), description: "", amount: "" });
    renderRecipeForm();
  });

  bindSubRecipeChips();
  const searchInput = $("#f-subrecipe-search");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const listEl = $("#f-subrecipe-list");
    if (!q) { listEl.classList.add("hidden"); listEl.innerHTML = ""; return; }
    const excludeIds = new Set(draft.subRecipeIds);
    if (state.view.editingId) excludeIds.add(state.view.editingId);
    const options = state.recipes.filter((r) => {
      if (excludeIds.has(r.id)) return false;
      if (!r.name.toLowerCase().includes(q)) return false;
      if (state.view.editingId) {
        // reject if this candidate already has the recipe-being-edited as a descendant (would create a cycle)
        if (descendantsOf(r.id).has(state.view.editingId)) return false;
      }
      return true;
    });
    listEl.innerHTML = options.length
      ? options.map((r) => `<div class="autocomplete-item" data-id="${r.id}">${escapeHtml(r.name)}</div>`).join("")
      : `<div class="autocomplete-item muted">No matches</div>`;
    listEl.classList.remove("hidden");
    $$(".autocomplete-item[data-id]", listEl).forEach((item) => {
      item.addEventListener("click", () => {
        draft.subRecipeIds.push(item.dataset.id);
        searchInput.value = "";
        listEl.classList.add("hidden");
        renderRecipeForm();
      });
    });
  });

  $("#save-recipe-btn").addEventListener("click", saveRecipeForm);
  $("#cancel-form-btn").addEventListener("click", () => {
    if (state.view.editingId) goDetail(state.view.editingId);
    else goTab("recipes");
  });
}

function bindIngredientRows() {
  $$(".ing-row").forEach((row) => {
    const localId = row.dataset.localId;
    const draft = state.formDraft;
    const ing = draft.ingredients.find((i) => i.localId === localId);
    $(".desc", row).addEventListener("input", (e) => (ing.description = e.target.value));
    $(".amt", row).addEventListener("input", (e) => (ing.amount = e.target.value));
    $(".rm", row).addEventListener("click", () => {
      draft.ingredients = draft.ingredients.filter((i) => i.localId !== localId);
      renderRecipeForm();
    });
  });
}

function bindSubRecipeChips() {
  $$("#f-subrecipe-chips .chip").forEach((chip) => {
    $(".x", chip).addEventListener("click", () => {
      state.formDraft.subRecipeIds = state.formDraft.subRecipeIds.filter((id) => id !== chip.dataset.id);
      renderRecipeForm();
    });
  });
}

async function saveRecipeForm() {
  const draft = state.formDraft;
  const name = draft.name.trim();
  if (!name) { toast("Please enter a recipe name."); return; }

  const cleanIngredients = draft.ingredients
    .map((i) => ({ description: i.description.trim(), amount: i.amount.trim() }))
    .filter((i) => i.description);

  let recipeId = state.view.editingId;
  if (recipeId) {
    const { error } = await supabase
      .from("recipes")
      .update({ name, servings: draft.servings.trim(), instructions: draft.instructions.trim(), updated_at: new Date().toISOString() })
      .eq("id", recipeId);
    if (error) { toast("Save failed: " + error.message); return; }
    await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId);
    await supabase.from("sub_recipes").delete().eq("parent_recipe_id", recipeId);
  } else {
    const { data, error } = await supabase
      .from("recipes")
      .insert({ name, servings: draft.servings.trim(), instructions: draft.instructions.trim() })
      .select()
      .single();
    if (error) { toast("Save failed: " + error.message); return; }
    recipeId = data.id;
  }

  if (cleanIngredients.length) {
    const rows = cleanIngredients.map((i, idx) => ({ recipe_id: recipeId, description: i.description, amount: i.amount, sort_order: idx }));
    const { error } = await supabase.from("recipe_ingredients").insert(rows);
    if (error) toast("Some ingredients failed to save: " + error.message);
  }

  if (draft.subRecipeIds.length) {
    const rows = draft.subRecipeIds.map((cid, idx) => ({ parent_recipe_id: recipeId, child_recipe_id: cid, sort_order: idx }));
    const { error } = await supabase.from("sub_recipes").insert(rows);
    if (error) toast("Some sub-recipes failed to save: " + error.message);
  }

  toast(state.view.editingId ? "Recipe updated." : "Recipe added.");
  await loadAll();
  goDetail(recipeId);
}

// ---------------------------------------------------------------------------
// Add-to-grocery modal (the "do you already have it" step)
// ---------------------------------------------------------------------------
function openAddToGroceryModal(recipeId) {
  const r = recipeById(recipeId);
  if (!r) return;
  const items = flattenIngredients(recipeId).map((it, idx) => ({ ...it, localId: `gi-${idx}`, have: false }));

  function bodyHtml() {
    if (!items.length) return `<p class="muted">This recipe has no ingredients listed yet.</p>`;
    return `
      <p class="have-it-hint">Check off anything you already have at home. Everything left unchecked gets added to your grocery list.</p>
      ${items
        .map(
          (it) => `
        <div class="checklist-row">
          <input type="checkbox" data-local-id="${it.localId}" ${it.have ? "checked" : ""} />
          <label>${escapeHtml(it.description)}${it.fromRecipeName && it.fromRecipeName !== r.name ? ` <span class="muted">(${escapeHtml(it.fromRecipeName)})</span>` : ""}</label>
          <span class="amt">${escapeHtml(it.amount)}</span>
        </div>`
        )
        .join("")}
    `;
  }

  function footerHtml() {
    const toAdd = items.filter((i) => !i.have).length;
    return `<button class="btn" id="skip-all">I have everything</button><button class="btn primary" id="confirm-add">Add ${toAdd} item${toAdd === 1 ? "" : "s"} to Grocery List</button>`;
  }

  function mount() {
    $$('#modal-body input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const item = items.find((i) => i.localId === e.target.dataset.localId);
        item.have = e.target.checked;
        $("#modal-footer").outerHTML = `<div class="action-row" id="modal-footer">${footerHtml()}</div>`;
        bindFooter();
      });
    });
    bindFooter();
  }

  function bindFooter() {
    $("#skip-all")?.addEventListener("click", closeModal);
    $("#confirm-add")?.addEventListener("click", async () => {
      const toInsert = items
        .filter((i) => !i.have)
        .map((i) => ({ description: i.description, amount: i.amount, source_recipe_name: r.name }));
      closeModal();
      if (!toInsert.length) { toast("Nothing added — you already have it all!"); return; }
      const { error } = await supabase.from("grocery_items").insert(toInsert);
      if (error) { toast("Could not add items: " + error.message); return; }
      toast(`Added ${toInsert.length} item${toInsert.length === 1 ? "" : "s"} to your grocery list.`);
      goTab("grocery");
    });
  }

  if (!items.length) {
    openModal({
      title: `Shop for "${r.name}"`,
      bodyHtml: bodyHtml(),
      footerHtml: `<button class="btn primary" id="skip-all">OK</button>`,
      onMount: () => $("#skip-all").addEventListener("click", closeModal),
    });
    return;
  }

  openModal({ title: `Shop for "${r.name}"`, bodyHtml: bodyHtml(), footerHtml: footerHtml(), onMount: mount });
}

// ---------------------------------------------------------------------------
// Grocery list
// ---------------------------------------------------------------------------
function renderGrocery() {
  const content = $("#content");
  const unchecked = state.grocery.filter((g) => !g.is_checked);
  const checked = state.grocery.filter((g) => g.is_checked);

  const rowHtml = (g) => `
    <div class="grocery-row ${g.is_checked ? "checked" : ""}" data-id="${g.id}">
      <div class="grocery-check ${g.is_checked ? "on" : ""}" data-toggle="${g.id}">${g.is_checked ? "✓" : ""}</div>
      <div class="g-text">
        <div class="g-desc">${escapeHtml(g.description)}</div>
        ${g.amount ? `<div class="g-amt">${escapeHtml(g.amount)}</div>` : ""}
        ${g.source_recipe_name ? `<div class="g-source">from ${escapeHtml(g.source_recipe_name)}</div>` : ""}
      </div>
      <button class="g-del" data-del="${g.id}" title="Remove">🗑</button>
    </div>`;

  content.innerHTML = `
    <div class="grocery-add-row">
      <input type="text" id="g-add-desc" placeholder="Add an item..." />
      <input type="text" id="g-add-amt" class="amt-input" placeholder="Amount" />
      <button class="btn primary sm" id="g-add-btn">Add</button>
    </div>
    ${unchecked.length ? `<div class="section-title">Need (${unchecked.length})</div>${unchecked.map(rowHtml).join("")}` : `<div class="empty-state">Your grocery list is empty. Add items above, or open a recipe and tap "Add to Grocery List."</div>`}
    ${checked.length ? `<div class="section-title">Have</div>${checked.map(rowHtml).join("")}<button class="btn sm" id="clear-checked-btn" style="margin-top:8px;">Clear completed</button>` : ""}
  `;

  $("#g-add-btn").addEventListener("click", addManualGroceryItem);
  $("#g-add-desc").addEventListener("keydown", (e) => { if (e.key === "Enter") addManualGroceryItem(); });

  $$("[data-toggle]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.toggle;
      const g = state.grocery.find((x) => x.id === id);
      const { error } = await supabase.from("grocery_items").update({ is_checked: !g.is_checked }).eq("id", id);
      if (error) toast("Could not update item: " + error.message);
    });
  });
  $$("[data-del]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.del;
      const { error } = await supabase.from("grocery_items").delete().eq("id", id);
      if (error) toast("Could not remove item: " + error.message);
    });
  });
  $("#clear-checked-btn")?.addEventListener("click", async () => {
    const ids = checked.map((g) => g.id);
    const { error } = await supabase.from("grocery_items").delete().in("id", ids);
    if (error) toast("Could not clear items: " + error.message);
  });
}

async function addManualGroceryItem() {
  const desc = $("#g-add-desc").value.trim();
  const amt = $("#g-add-amt").value.trim();
  if (!desc) return;
  const { error } = await supabase.from("grocery_items").insert({ description: desc, amount: amt });
  if (error) { toast("Could not add item: " + error.message); return; }
  $("#g-add-desc").value = "";
  $("#g-add-amt").value = "";
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  await initAuth();
  initRealtime();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();
