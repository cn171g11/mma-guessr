package util

import "time"

// Now returns the current UTC time in RFC3339 format for storage.
func Now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// NowMilli returns the current UTC unix time in milliseconds.
func NowMilli() int64 {
	return time.Now().UTC().UnixMilli()
}

// NowTime returns the current UTC time.
func NowTime() time.Time {
	return time.Now().UTC()
}

// ParseTime parses an RFC3339 timestamp; zero time is returned on error.
func ParseTime(value string) time.Time {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return t.UTC()
}

// NowRFC3339Add returns an RFC3339 timestamp `seconds` in the future.
func NowRFC3339Add(seconds int) string {
	return time.Now().UTC().Add(time.Duration(seconds) * time.Second).Format(time.RFC3339)
}

// UTCDate returns today's UTC date in YYYY-MM-DD format.
func UTCDate() string {
	return time.Now().UTC().Format("2006-01-02")
}

// SecondsUntilUTCMidnight returns the number of seconds until the next UTC
// midnight, used for expiring daily "played" claims.
func SecondsUntilUTCMidnight() int {
	now := time.Now().UTC()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 24, 0, 0, 0, time.UTC)
	return int(midnight.Sub(now).Seconds())
}
