package platform

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type apiError struct {
	Status        int
	Message, Code string
}

func (e *apiError) Error() string { return e.Message }
func invalid(s string) error      { return &apiError{422, s, "validation"} }
func forbidden(s string) error    { return &apiError{403, s, "forbidden"} }
func missing(s string) error      { return &apiError{404, s, "not_found"} }
func conflict(s, c string) error  { return &apiError{409, s, c} }
func decode(r *http.Request, v any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return invalid("请求JSON无效: " + err.Error())
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return invalid("请求只能包含一个JSON对象")
	}
	return nil
}
func validText(s, label string, max int) error {
	if strings.TrimSpace(s) == "" {
		return invalid(label + "不能为空")
	}
	if len([]rune(s)) > max {
		return invalid(label + "过长")
	}
	return nil
}
func enum(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}

type actorKey struct{}

func actor(r *http.Request) Member { return r.Context().Value(actorKey{}).(Member) }

type handler func(http.ResponseWriter, *http.Request) (any, error)

func wrap(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := h(w, r)
		if err != nil {
			var e *apiError
			if !errors.As(err, &e) {
				slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
				e = &apiError{500, "服务暂时不可用，请稍后重试", "internal"}
			}
			write(w, e.Status, map[string]string{"error": e.Message, "code": e.Code})
			return
		}
		if v == nil {
			v = map[string]bool{"ok": true}
		}
		write(w, 200, v)
	}
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (s *Store) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", wrap(func(w http.ResponseWriter, r *http.Request) (any, error) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.Pool.Ping(ctx); err != nil {
			return nil, &apiError{503, "数据库未就绪", "unavailable"}
		}
		return map[string]string{"status": "ok", "service": "intelligent-organization"}, nil
	}))
	api := http.NewServeMux()
	api.HandleFunc("/", wrap(func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, missing("接口不存在") }))
	api.HandleFunc("GET /api/me", wrap(func(w http.ResponseWriter, r *http.Request) (any, error) { return actor(r), nil }))
	api.HandleFunc("GET /api/members", wrap(s.listMembers))
	api.HandleFunc("POST /api/members", wrap(s.createMember))
	api.HandleFunc("POST /api/members/{id}/deactivate", wrap(s.deactivateMember))
	api.HandleFunc("GET /api/projects", wrap(s.listProjects))
	api.HandleFunc("POST /api/projects", wrap(s.createProject))
	api.HandleFunc("GET /api/projects/{pid}/snapshot", wrap(s.getSnapshot))
	api.HandleFunc("PATCH /api/projects/{pid}/nodes/{id}", wrap(s.patchNode))
	api.HandleFunc("POST /api/projects/{pid}/tasks", wrap(s.createTask))
	api.HandleFunc("PATCH /api/projects/{pid}/tasks/{id}", wrap(s.patchTask))
	api.HandleFunc("GET /api/projects/{pid}/tasks/{id}/context", wrap(s.taskContext))
	api.HandleFunc("POST /api/projects/{pid}/tasks/{id}/sync", wrap(s.syncTask))
	api.HandleFunc("POST /api/projects/{pid}/tasks/{id}/submit", wrap(s.submitTask))
	api.HandleFunc("POST /api/projects/{pid}/memories", wrap(s.createMemory))
	api.HandleFunc("PATCH /api/projects/{pid}/memories/{id}", wrap(s.patchMemory))
	api.HandleFunc("GET /api/projects/{pid}/memories/{id}/history", wrap(s.memoryHistory))
	api.HandleFunc("POST /api/projects/{pid}/issues", wrap(s.createIssue))
	api.HandleFunc("PATCH /api/projects/{pid}/issues/{id}", wrap(s.patchIssue))
	api.HandleFunc("POST /api/projects/{pid}/handovers", wrap(s.createHandover))
	api.HandleFunc("POST /api/projects/{pid}/handovers/{id}/accept", wrap(s.acceptHandover))
	api.HandleFunc("POST /api/projects/{pid}/reuse", wrap(s.reuseProject))
	api.HandleFunc("POST /api/projects/{pid}/usage", wrap(s.reportUsage))
	api.HandleFunc("GET /api/notifications", wrap(s.listNotifications))
	api.HandleFunc("POST /api/notifications/{id}/read", wrap(s.readNotification))
	api.HandleFunc("GET /api/conversations", wrap(s.listConversations))
	api.HandleFunc("POST /api/conversations", wrap(s.createConversation))
	api.HandleFunc("GET /api/conversations/{cid}/messages", wrap(s.listMessages))
	api.HandleFunc("POST /api/conversations/{cid}/messages", wrap(s.postMessage))
	api.HandleFunc("POST /api/conversations/{cid}/read", wrap(s.readConversation))
	api.HandleFunc("POST /api/conversations/{cid}/messages/{mid}/promote", wrap(s.promoteMessage))
	mux.Handle("/api/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			write(w, 401, map[string]string{"error": "请提供成员访问令牌", "code": "unauthorized"})
			return
		}
		m, err := s.Authenticate(r.Context(), strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")))
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				slog.Error("authentication failed", "error", err)
			}
			write(w, 401, map[string]string{"error": "访问令牌无效或成员已停用", "code": "unauthorized"})
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), actorKey{}, m))
		api.ServeHTTP(w, r)
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == "OPTIONS" {
			if origin != "" && !allowedOrigin(origin) {
				write(w, 403, map[string]string{"error": "不允许的来源"})
				return
			}
			w.WriteHeader(204)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func allowedOrigin(s string) bool {
	return enum(s, "http://localhost:1420", "http://127.0.0.1:1420", "http://localhost:5173", "http://127.0.0.1:5173", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost")
}
func requireAdmin(m Member) error {
	if !isAdmin(m) {
		return forbidden("仅管理员可以执行此操作")
	}
	return nil
}
