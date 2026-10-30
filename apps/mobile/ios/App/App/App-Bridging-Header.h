// C APIs the app calls from Swift: sherpa-onnx for the Neural voices (its official
// SherpaOnnx.swift wrapper needs this header) and libbz2 from the iOS SDK for unpacking
// the downloaded voice archives.
#import "sherpa-onnx/c-api/c-api.h"
#include <bzlib.h>
