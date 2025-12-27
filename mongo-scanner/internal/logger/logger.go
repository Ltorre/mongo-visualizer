package logger

import (
	"fmt"
	"io"
	"os"
	"time"
)

// LogLevel represents the logging level
type LogLevel int

const (
	LevelDebug LogLevel = iota
	LevelInfo
	LevelWarn
	LevelError
)

// Logger handles logging with levels
type Logger struct {
	level  LogLevel
	output io.Writer
}

// NewLogger creates a new logger
func NewLogger(verbose bool) *Logger {
	level := LevelInfo
	if verbose {
		level = LevelDebug
	}
	return &Logger{
		level:  level,
		output: os.Stderr,
	}
}

// SetOutput sets the output writer
func (l *Logger) SetOutput(w io.Writer) {
	l.output = w
}

func (l *Logger) log(level LogLevel, prefix string, format string, args ...interface{}) {
	if level < l.level {
		return
	}

	timestamp := time.Now().Format("15:04:05")
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(l.output, "[%s] %s %s\n", timestamp, prefix, msg)
}

// Debug logs a debug message
func (l *Logger) Debug(format string, args ...interface{}) {
	l.log(LevelDebug, "DEBUG", format, args...)
}

// Info logs an info message
func (l *Logger) Info(format string, args ...interface{}) {
	l.log(LevelInfo, "INFO ", format, args...)
}

// Warn logs a warning message
func (l *Logger) Warn(format string, args ...interface{}) {
	l.log(LevelWarn, "WARN ", format, args...)
}

// Error logs an error message
func (l *Logger) Error(format string, args ...interface{}) {
	l.log(LevelError, "ERROR", format, args...)
}

// Progress displays a progress update
func (l *Logger) Progress(current, total int, message string) {
	percent := float64(current) / float64(total) * 100
	fmt.Fprintf(l.output, "\r[%3.0f%%] %s (%d/%d)", percent, message, current, total)
	if current == total {
		fmt.Fprintln(l.output)
	}
}
