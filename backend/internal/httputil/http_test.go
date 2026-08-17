package httputil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func decodeBody(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func TestPayloadPaddingAddsRandomPadToObjects(t *testing.T) {
	EnablePayloadPadding(true)
	defer EnablePayloadPadding(false)

	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, map[string]any{"status": "ok"})
	body := decodeBody(t, rec.Body.Bytes())
	if body["status"] != "ok" {
		t.Fatalf("original field must survive padding, got %v", body)
	}
	pad, ok := body["_pad"].(string)
	if !ok || pad == "" {
		t.Fatalf("expected a non-empty _pad field, got %v", body)
	}

	// Two responses must differ (random span).
	rec2 := httptest.NewRecorder()
	WriteJSON(rec2, http.StatusOK, map[string]any{"status": "ok"})
	body2 := decodeBody(t, rec2.Body.Bytes())
	if body2["_pad"] == body["_pad"] {
		t.Fatal("padding must be random across responses")
	}
}

func TestPayloadPaddingLeavesArraysUntouched(t *testing.T) {
	EnablePayloadPadding(true)
	defer EnablePayloadPadding(false)

	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, []any{map[string]any{"id": 1}})
	var raw []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode array: %v", err)
	}
	if len(raw) != 1 {
		t.Fatalf("expected 1 element, got %v", raw)
	}
	if _, ok := raw[0]["_pad"]; ok {
		t.Fatalf("array elements must not be padded, got %v", raw)
	}
}

func TestPayloadPaddingDisabledByDefault(t *testing.T) {
	EnablePayloadPadding(false)
	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, map[string]any{"status": "ok"})
	body := decodeBody(t, rec.Body.Bytes())
	if _, ok := body["_pad"]; ok {
		t.Fatalf("padding must be off when disabled, got %v", body)
	}
}
