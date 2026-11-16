package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"intelligent-organization/server/internal/platform"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db := os.Getenv("IO_DATABASE_URL")
	if db == "" {
		return &configError{"IO_DATABASE_URL is required"}
	}
	store, err := platform.Open(ctx, db, os.Getenv("IO_ADMIN_TOKEN"))
	if err != nil {
		return err
	}
	defer store.Pool.Close()
	addr := os.Getenv("IO_ADDR")
	if addr == "" {
		addr = "127.0.0.1:17890"
	}
	server := &http.Server{Addr: addr, Handler: store.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	done := make(chan error, 1)
	go func() {
		slog.Info("Intelligent Organization service listening", "address", addr)
		done <- server.ListenAndServe()
	}()
	select {
	case err = <-done:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}

type configError struct{ message string }

func (e *configError) Error() string { return e.message }
