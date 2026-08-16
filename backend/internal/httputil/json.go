package httputil

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// DecodeJSON reads and decodes a JSON request body into dst, enforcing the
// 1MB size cap. Unknown fields are rejected to keep the contract strict.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxBodyBytes+1))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "读取请求体失败")
		return err
	}
	if len(body) > MaxBodyBytes {
		WriteError(w, http.StatusRequestEntityTooLarge, "请求体过大")
		return errors.New("request body too large")
	}
	if len(body) == 0 {
		WriteError(w, http.StatusBadRequest, "请求体不能为空")
		return errors.New("empty request body")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		WriteError(w, http.StatusBadRequest, "请求体格式不正确")
		return err
	}
	return nil
}
