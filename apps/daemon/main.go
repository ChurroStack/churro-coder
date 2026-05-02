package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
)

const version = "0.0.1"

func versionString() string {
	return fmt.Sprintf("churro-code daemon %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)
}

func main() {
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(versionString())
		return
	}

	fmt.Printf("churro-code daemon v%s starting on %s/%s\n", version, runtime.GOOS, runtime.GOARCH)
	fmt.Println("hello from the daemon (bare-bones; replace with real service loop)")
	os.Exit(0)
}
