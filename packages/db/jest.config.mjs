const config = {
    preset: "ts-jest/presets/default-esm",
    testEnvironment: "node",
    extensionsToTreatAsEsm: [".ts"],
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                useESM: true,
                tsconfig: {
                    module: "NodeNext",
                    moduleResolution: "NodeNext",
                    target: "ES2022",
                },
            },
        ],
    },
    testMatch: ["**/__tests__/**/*.test.ts"],
    verbose: true,
};

export default config; 