add_library(pixi_native_gpu SHARED
    "Module.cpp"
    "${PROJECT_SOURCE_DIR}/src/dawn/node/ManualConstructors.cpp"
)
set(PIXI_DAWN_NODE_GEN_DIR "${PROJECT_BINARY_DIR}/gen/node")
set_target_properties(pixi_native_gpu PROPERTIES
    PREFIX ""
    OUTPUT_NAME "pixi_native_gpu"
    SUFFIX ".node"
    ARCHIVE_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}"
    RUNTIME_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}"
    LIBRARY_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}"
    CXX_STANDARD 20
)
target_link_libraries(pixi_native_gpu
    PRIVATE
        dawncpp
        dawn_native
        dawn_node_binding
        dawn_node_interop
        dawn_proc
        dawn_warnings_config
        libtint
)
target_include_directories(pixi_native_gpu
    PRIVATE
        "${PROJECT_SOURCE_DIR}"
        "${PIXI_DAWN_NODE_GEN_DIR}"
)
target_include_directories(pixi_native_gpu SYSTEM
    PRIVATE
        "${PROJECT_SOURCE_DIR}/third_party/node-addon-api"
        "${PROJECT_SOURCE_DIR}/third_party/node-api-headers/include"
)

if(WIN32)
    target_compile_options(pixi_native_gpu PRIVATE /wd4063 /wd4715 /ZW:nostdlib /EHsc)
    cmake_language(
        DEFER
        DIRECTORY "${CMAKE_SOURCE_DIR}"
        CALL add_dependencies pixi_native_gpu napi-symbols
    )
    target_link_libraries(pixi_native_gpu PRIVATE "${PIXI_DAWN_NODE_GEN_DIR}/NapiSymbols.lib")
else()
    target_sources(pixi_native_gpu PRIVATE "${PROJECT_SOURCE_DIR}/src/dawn/node/NapiSymbols.cpp")
    target_compile_definitions(pixi_native_gpu PRIVATE "NAPI_SYMBOL_WEAK_DECL_ONLY")
    if(APPLE)
        target_link_options(pixi_native_gpu PRIVATE "-Wl,-undefined,dynamic_lookup")
    endif()
endif()
